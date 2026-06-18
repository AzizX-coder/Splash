import type { ConnectorAction, Result, ToolDefinition } from "@splash/utils";
import { ok, err, createError, createLogger } from "@splash/utils";
import type { Connector } from "./connector.js";

const log = createLogger("connector:http");

/**
 * Generic HTTP connector — GET / POST / PUT / DELETE with JSON or form bodies.
 * Useful for agents talking to arbitrary REST endpoints.
 */
export class HttpConnector implements Connector {
  readonly name = "http";
  readonly category = "api" as const;
  readonly description = "Make HTTP requests (GET/POST/PUT/DELETE) to arbitrary URLs.";

  private defaultTimeoutMs: number;
  private maxBodyBytes: number;

  constructor(opts?: { timeoutMs?: number; maxBodyBytes?: number }) {
    this.defaultTimeoutMs = opts?.timeoutMs ?? 20_000;
    this.maxBodyBytes = opts?.maxBodyBytes ?? 512_000;
  }

  listActions(): ConnectorAction[] {
    return [
      {
        name: "request",
        description: "Perform an HTTP request. Returns { status, headers, body }.",
        riskLevel: "moderate",
        parameters: {
          type: "object",
          properties: {
            url:     { type: "string", description: "Absolute URL (http or https)." },
            method:  { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], description: "HTTP method." },
            headers: { type: "object", description: "Optional request headers (string values).", additionalProperties: { type: "string" } },
            body:    { description: "Optional request body. If it's an object, it's sent as JSON." },
            timeoutMs: { type: "number", description: "Optional request timeout in ms." },
          },
          required: ["url"],
        },
      },
    ];
  }

  toToolDefinitions(): ToolDefinition[] {
    return this.listActions().map((a) => ({
      name: `${this.name}.${a.name}`,
      description: a.description,
      parameters: a.parameters,
    }));
  }

  async isAvailable(): Promise<boolean> {
    return typeof fetch === "function";
  }

  async execute(action: string, args: Record<string, unknown>): Promise<Result<unknown>> {
    if (action !== "request") {
      return err(createError("connector", `Unknown http action: ${action}`));
    }

    const url = String(args.url || "");
    const method = String(args.method || "GET").toUpperCase();
    const headers = (args.headers as Record<string, string>) || {};
    const timeoutMs = Number(args.timeoutMs || this.defaultTimeoutMs);

    if (!/^https?:\/\//i.test(url)) {
      return err(createError("connector", "URL must be absolute http(s)."));
    }

    let body: string | undefined;
    if (args.body !== undefined && args.body !== null) {
      if (typeof args.body === "string") {
        body = args.body;
      } else {
        body = JSON.stringify(args.body);
        if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
          headers["Content-Type"] = "application/json";
        }
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    log.debug("http request", { method, url });

    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal });
      const buf = await res.arrayBuffer();
      const truncated = buf.byteLength > this.maxBodyBytes;
      const slice = truncated ? buf.slice(0, this.maxBodyBytes) : buf;
      const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);

      const hdrs: Record<string, string> = {};
      res.headers.forEach((v, k) => { hdrs[k] = v; });

      let parsed: unknown = text;
      if ((hdrs["content-type"] || "").includes("application/json")) {
        try { parsed = JSON.parse(text); } catch { /* leave as text */ }
      }

      return ok({
        status: res.status,
        ok: res.ok,
        headers: hdrs,
        body: parsed,
        truncated,
      });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return err(createError("timeout", `HTTP request timed out after ${timeoutMs}ms`, { retryable: true }));
      }
      return err(createError("connector", `HTTP request failed: ${e?.message || e}`, { retryable: true }));
    } finally {
      clearTimeout(timer);
    }
  }
}
