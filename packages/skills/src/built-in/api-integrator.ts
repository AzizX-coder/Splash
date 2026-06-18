import type { SkillManifest, SkillResult, Result } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

export class ApiIntegratorSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "api-integrator",
    description: "Make HTTP requests to external APIs with structured request/response handling",
    version: "1.0.0",
    tags: ["api", "http", "rest", "integration", "request"],
    requiredConnectors: ["webhook"],
    parameters: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "Registered webhook endpoint alias to call",
        },
        method: {
          type: "string",
          enum: ["GET", "POST"],
          description: "HTTP method",
        },
        payload: {
          type: "object",
          description: "Request payload (for POST)",
        },
        queryParams: {
          type: "object",
          description: "Query parameters (for GET)",
        },
        extractFields: {
          type: "array",
          items: { type: "string" },
          description: "Fields to extract from the response",
        },
      },
      required: ["endpoint"],
    },
  };

  async execute(
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<Result<SkillResult>> {
    const endpoint = params["endpoint"] as string;
    const method = (params["method"] as string) || "GET";
    const extractFields = params["extractFields"] as string[] | undefined;

    if (!endpoint) return err(createError("skill", "endpoint is required"));

    ctx.log("API integration call", { endpoint, method });

    let result: Result<unknown>;

    if (method === "POST") {
      const payload = (params["payload"] as Record<string, unknown>) || {};
      result = await ctx.runConnector("webhook.send", { endpoint, payload });
    } else {
      const queryParams = params["queryParams"] as Record<string, string> | undefined;
      result = await ctx.runConnector("webhook.fetch", { endpoint, queryParams });
    }

    if (!result.ok) return result as Result<never>;

    const response = result.value as { status: number; body: unknown };

    // Extract specific fields if requested
    let output = response.body;
    if (extractFields && typeof response.body === "object" && response.body !== null) {
      const extracted: Record<string, unknown> = {};
      for (const field of extractFields) {
        extracted[field] = (response.body as Record<string, unknown>)[field];
      }
      output = extracted;
    }

    return ok({
      success: response.status >= 200 && response.status < 300,
      output: { status: response.status, data: output },
      summary: `API ${method} to ${endpoint}: status ${response.status}`,
    });
  }
}
