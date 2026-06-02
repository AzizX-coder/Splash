import { z } from "zod";
import { 
  type Result, 
  ok, 
  err, 
  createError,
  type CompletionRequest,
  type CompletionResponse,
} from "@alpclaw/utils";
import {
  type ModelProvider,
  type ProviderCapabilities,
} from "./provider.js";

// Basic Ollama API schema validation
const OllamaResponseSchema = z.object({
  model: z.string(),
  message: z
    .object({
      role: z.string(),
      content: z.string(),
      tool_calls: z
        .array(
          z.object({
            function: z.object({
              name: z.string(),
              arguments: z.record(z.unknown()),
            }),
          }),
        )
        .optional(),
    })
    .optional(),
  done: z.boolean(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});

export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:11434") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  isAvailable(): boolean {
    return true; // We assume true but actually check during listModels or complete
  }

  async healthcheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<{ id: string; isFree: boolean; contextTokens?: number }[]> {
    return Promise.resolve([
      { id: "llama3", isFree: true },
      { id: "phi3", isFree: true },
      { id: "mistral", isFree: true },
      { id: "qwen2", isFree: true },
      { id: "codestral", isFree: true },
    ]);
  }

  static capabilities(): ProviderCapabilities {
    return {
      name: "ollama",
      supportsTools: true, // Requires new Ollama versions
      supportsStreaming: true,
      supportsVision: true, // Supported by llava models
      maxContextTokens: 8192,
      costTier: "free",
      strengthProfile: {
        reasoning: 6,
        coding: 6,
        creativity: 5,
        speed: 8,
        accuracy: 6,
      },
    };
  }

  async complete(request: CompletionRequest): Promise<Result<CompletionResponse>> {
    try {
      const url = `${this.baseUrl}/api/chat`;

      const payload: any = {
        model: request.model || "llama3", // Default cleanly to llama3 if router doesn't pass one
        messages: request.messages.map((m: any) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        })),
        stream: false,
      };

      // Extract system prompts from messages
      const systemMsg = request.messages.find(m => m.role === "system");
      if (systemMsg) {
        payload.messages = request.messages.filter(m => m.role !== "system");
        payload.messages.unshift({ role: "system", content: systemMsg.content });
      }

      if (request.tools && request.tools.length > 0) {
        payload.tools = request.tools.map((t: any) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));
      }

      if (request.temperature !== undefined) {
        payload.options = { temperature: request.temperature };
      }

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        return err(createError("provider", `Ollama API error: ${response.status} ${response.statusText} - ${text}`));
      }

      const data = await response.json();
      const parsed = OllamaResponseSchema.parse(data);

      const messageContent = parsed.message?.content || "";
      const toolCalls = parsed.message?.tool_calls?.map((tc) => ({
        id: `call_${Math.random().toString(36).substring(2)}`,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));

      return ok({
        content: messageContent,
        toolCalls,
        usage: {
          promptTokens: parsed.prompt_eval_count || 0,
          completionTokens: parsed.eval_count || 0,
          totalTokens: (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0),
        },
        model: parsed.model || request.model || "ollama",
        finishReason: parsed.done ? (toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop") : "error",
      });
    } catch (error) {
      return err(createError("provider", String(error)));
    }
  }
}
