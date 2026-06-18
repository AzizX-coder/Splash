import type { ConnectorAction, Result, ToolDefinition } from "@splash/utils";
import { ok, err, createError, createLogger } from "@splash/utils";
import type { Connector } from "./connector.js";

const log = createLogger("connector:webhook");

/**
 * Webhook connector — send HTTP requests to arbitrary endpoints.
 * Useful for integrations with Slack, Discord, Telegram, custom APIs, etc.
 */
export class WebhookConnector implements Connector {
  readonly name = "webhook";
  readonly category = "webhook" as const;
  readonly description = "Send HTTP requests to webhook endpoints and APIs";

  /** Pre-registered webhook URLs by alias, so the LLM never sees raw URLs. */
  private endpoints = new Map<string, { url: string; headers?: Record<string, string>; hmacSecret?: string; maxRetries?: number }>();

  constructor(
    endpoints?: Record<string, { url: string; headers?: Record<string, string>; hmacSecret?: string; maxRetries?: number }>,
  ) {
    if (endpoints) {
      for (const [alias, config] of Object.entries(endpoints)) {
        this.endpoints.set(alias, config);
      }
    }
  }

  /** Register a named endpoint. */
  registerEndpoint(
    alias: string,
    url: string,
    headers?: Record<string, string>,
    hmacSecret?: string,
    maxRetries?: number
  ): void {
    this.endpoints.set(alias, { url, headers, hmacSecret, maxRetries: maxRetries || 3 });
    log.info("Webhook endpoint registered", { alias });
  }

  listActions(): ConnectorAction[] {
    return [
      {
        name: "send",
        description: "Send a POST request to a registered webhook endpoint",
        parameters: {
          type: "object",
          properties: {
            endpoint: {
              type: "string",
              description: "Registered endpoint alias",
            },
            payload: {
              type: "object",
              description: "JSON payload to send",
            },
          },
          required: ["endpoint", "payload"],
        },
        riskLevel: "moderate",
      },
      {
        name: "fetch",
        description: "Send a GET request to a registered endpoint",
        parameters: {
          type: "object",
          properties: {
            endpoint: {
              type: "string",
              description: "Registered endpoint alias",
            },
            queryParams: {
              type: "object",
              description: "Query parameters",
            },
          },
          required: ["endpoint"],
        },
        riskLevel: "safe",
      },
      {
        name: "replayDlq",
        description: "Replay failed webhooks from the Dead Letter Queue",
        parameters: {
          type: "object",
          properties: {},
        },
        riskLevel: "moderate",
      },
    ];
  }

  toToolDefinitions(): ToolDefinition[] {
    return this.listActions().map((action) => ({
      name: `${this.name}.${action.name}`,
      description: `${action.description}. Available endpoints: ${Array.from(this.endpoints.keys()).join(", ") || "none registered"}`,
      parameters: action.parameters,
    }));
  }

  async execute(action: string, args: Record<string, unknown>): Promise<Result<unknown>> {
    const alias = args["endpoint"] as string;
    const endpoint = this.endpoints.get(alias);
    if (!endpoint) {
      return err(
        createError("connector", `Unknown webhook endpoint: ${alias}. Register it first.`),
      );
    }

    switch (action) {
      case "send":
        return this.sendPost(alias, endpoint, args["payload"] as Record<string, unknown>);
      case "fetch":
        return this.sendGet(endpoint, args["queryParams"] as Record<string, string> | undefined);
      case "replayDlq":
        return this.replayDlq();
      default:
        return err(createError("connector", `Unknown webhook action: ${action}`));
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.endpoints.size > 0;
  }

  private async sendPost(
    alias: string,
    endpoint: { url: string; headers?: Record<string, string>; hmacSecret?: string; maxRetries?: number },
    payload: Record<string, unknown>,
  ): Promise<Result<unknown>> {
    const maxRetries = endpoint.maxRetries || 3;
    let attempt = 0;

    const payloadString = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...endpoint.headers,
    };

    if (endpoint.hmacSecret) {
      const crypto = await import("node:crypto");
      const signature = crypto.createHmac("sha256", endpoint.hmacSecret).update(payloadString, "utf-8").digest("hex");
      headers["X-Hub-Signature-256"] = `sha256=${signature}`;
    }

    while (attempt <= maxRetries) {
      try {
        log.info(`Sending webhook POST (attempt ${attempt + 1})`, { url: endpoint.url.slice(0, 50) });
        const res = await fetch(endpoint.url, {
          method: "POST",
          headers,
          body: payloadString,
        });

        if (!res.ok && res.status >= 500 && attempt < maxRetries) {
          attempt++;
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt))); // Exponential backoff
          continue;
        }

        const text = await res.text();
        let body: unknown;
        try { body = JSON.parse(text); } catch { body = text; }

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
        return ok({ status: res.status, body });
      } catch (cause) {
        if (attempt < maxRetries) {
          attempt++;
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }
        await this.addToDlq(alias, payload);
        return err(createError("connector", "Webhook POST failed, added to DLQ", { cause, retryable: false }));
      }
    }
    return err(createError("connector", "Webhook POST exhausted retries"));
  }

  private async addToDlq(alias: string, payload: Record<string, unknown>) {
    try {
      const fs = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");
      const dlqPath = path.join(os.homedir(), ".splash", "webhook_dlq.json");
      let dlq: any[] = [];
      try {
        const content = await fs.readFile(dlqPath, "utf-8");
        dlq = JSON.parse(content);
      } catch {}
      dlq.push({ alias, payload, timestamp: Date.now() });
      await fs.writeFile(dlqPath, JSON.stringify(dlq), "utf-8");
      log.warn("Webhook added to DLQ", { alias });
    } catch (e) {
      log.error("Failed to write to webhook DLQ", { error: String(e) });
    }
  }

  private async replayDlq(): Promise<Result<unknown>> {
    try {
      const fs = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");
      const dlqPath = path.join(os.homedir(), ".splash", "webhook_dlq.json");
      let dlq: any[] = [];
      try {
        const content = await fs.readFile(dlqPath, "utf-8");
        dlq = JSON.parse(content);
      } catch {
        return ok({ replayed: 0, failed: 0 });
      }

      const newDlq: any[] = [];
      let successCount = 0;
      let failCount = 0;

      for (const item of dlq) {
        const endpoint = this.endpoints.get(item.alias);
        if (!endpoint) {
          newDlq.push(item);
          failCount++;
          continue;
        }
        const result = await this.sendPost(item.alias, endpoint, item.payload);
        if (result.ok) successCount++;
        else {
          newDlq.push(item);
          failCount++;
        }
      }

      await fs.writeFile(dlqPath, JSON.stringify(newDlq), "utf-8");
      return ok({ replayed: successCount, failed: failCount });
    } catch (e: any) {
      return err(createError("connector", `Failed to replay DLQ: ${e.message}`));
    }
  }

  private async sendGet(
    endpoint: { url: string; headers?: Record<string, string> },
    queryParams?: Record<string, string>,
  ): Promise<Result<unknown>> {
    try {
      let url = endpoint.url;
      if (queryParams) {
        const params = new URLSearchParams(queryParams);
        url += `?${params.toString()}`;
      }
      const res = await fetch(url, {
        headers: endpoint.headers,
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return ok({ status: res.status, body });
    } catch (cause) {
      return err(createError("connector", "Webhook GET failed", { cause, retryable: true }));
    }
  }
}
