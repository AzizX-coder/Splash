import type {
  CompletionRequest,
  CompletionResponse,
  Result,
  Message,
  ToolCall,
  ToolDefinition,
} from "@alpclaw/utils";
import { ok, err, createError, createLogger } from "@alpclaw/utils";
import type { ModelProvider, ProviderCapabilities } from "./provider.js";

const log = createLogger("provider:claude");

/**
 * Claude (Anthropic) provider implementation.
 * Uses the Anthropic Messages API directly via fetch.
 */
export class ClaudeProvider implements ModelProvider {
  readonly name = "claude" as const;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = "https://api.anthropic.com") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async healthcheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<{ id: string; isFree: boolean; contextTokens?: number }[]> {
    return Promise.resolve([
      { id: "claude-opus-4-20250514", isFree: false },
      { id: "claude-sonnet-4-20250514", isFree: false },
      { id: "claude-haiku-4-20250514", isFree: false },
    ]);
  }

  async complete(request: CompletionRequest): Promise<Result<CompletionResponse>> {
    try {
      const model = request.model || "claude-sonnet-4-20250514";
      const { system, messages } = this.convertMessages(request.messages);

      const body: Record<string, unknown> = {
        model,
        max_tokens: request.maxTokens || 4096,
        messages,
      };

      if (system) body.system = system;
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.stop) body.stop_sequences = request.stop;

      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map((t) => this.convertTool(t));
      }

      log.debug("Sending request to Claude", { model, messageCount: messages.length });

      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return err(
          createError("provider", `Claude API error ${response.status}: ${errorText}`, {
            retryable: response.status >= 500 || response.status === 429,
          }),
        );
      }

      const data = (await response.json()) as AnthropicResponse;
      return ok(this.parseResponse(data, model));
    } catch (cause) {
      return err(createError("provider", "Claude request failed", { cause, retryable: true }));
    }
  }

  private convertMessages(messages: Message[]): { system?: string; messages: AnthropicMessage[] } {
    let system: string | undefined;
    const converted: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        system = msg.content;
        continue;
      }

      if (msg.role === "tool") {
        converted.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId || "",
              content: msg.content || "",
            },
          ],
        });
        continue;
      }

      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        const content: AnthropicContent[] = [];
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        converted.push({ role: "assistant", content });
        continue;
      }

      converted.push({
        role: msg.role as "user" | "assistant",
        content: msg.content || "",
      });
    }

    return { system, messages: converted };
  }

  private convertTool(tool: ToolDefinition): AnthropicTool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    };
  }

  private parseResponse(data: AnthropicResponse, model: string): CompletionResponse {
    let content = "";
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === "text" && block.text) {
        content += block.text;
      } else if (block.type === "tool_use" && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      model,
      finishReason: data.stop_reason === "tool_use" ? "tool_calls" : "stop",
    };
  }

  static capabilities(): ProviderCapabilities {
    return {
      name: "claude",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
      maxContextTokens: 200000,
      costTier: "high",
      strengthProfile: {
        reasoning: 10,
        coding: 10,
        creativity: 9,
        speed: 7,
        accuracy: 10,
      },
    };
  }
}

// ── Anthropic API types (minimal) ────────────────────────────────────────────

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}

interface AnthropicContent {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicResponse {
  content: AnthropicContent[];
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
