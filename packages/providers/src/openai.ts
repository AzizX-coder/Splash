import type {
  CompletionRequest,
  CompletionResponse,
  Result,
  Message,
  ToolCall,
  ToolDefinition,
} from "@splash/utils";
import { ok, err, createError, createLogger } from "@splash/utils";
import type { ModelProvider, ProviderCapabilities } from "./provider.js";
import { readGlobalConfig } from "@splash/config";

const log = createLogger("provider:openai");

/**
 * OpenAI provider implementation.
 * Also works with any OpenAI-compatible API (DeepSeek, local, etc.).
 */
export class OpenAIProvider implements ModelProvider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(
    apiKey?: string,
    opts?: { name?: string; baseUrl?: string; defaultModel?: string },
  ) {
    this.name = opts?.name || "openai";
    const envKey = process.env[`${this.name.toUpperCase()}_API_KEY`];
    const configKey = readGlobalConfig().apiKeys?.[this.name];
    this.apiKey = apiKey || envKey || configKey || "";

    if (!this.apiKey) {
      const niceName = this.name.charAt(0).toUpperCase() + this.name.slice(1);
      throw new Error(`[ERR] Not configured: Missing ${niceName} API key`);
    }

    this.baseUrl = opts?.baseUrl || "https://api.openai.com/v1";
    this.defaultModel = opts?.defaultModel || "gpt-4o";
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async healthcheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<{ id: string; isFree: boolean; contextTokens?: number }[]> {
    if (this.name === "deepseek") {
      return Promise.resolve([
        { id: "deepseek-chat", isFree: false },
        { id: "deepseek-reasoner", isFree: false },
      ]);
    }
    return Promise.resolve([
      { id: "gpt-4o", isFree: false },
      { id: "gpt-4o-mini", isFree: false },
      { id: "o3", isFree: false },
      { id: "o4-mini", isFree: false },
    ]);
  }

  async complete(request: CompletionRequest): Promise<Result<CompletionResponse>> {
    try {
      const model = request.model || this.defaultModel;

      const body: Record<string, unknown> = {
        model,
        messages: this.convertMessages(request.messages),
        max_tokens: request.maxTokens || 4096,
      };

      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.stop) body.stop = request.stop;

      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map((t) => this.convertTool(t));
      }

      log.debug("Sending request to OpenAI-compatible API", { model, provider: this.name });

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return err(
          createError("provider", `${this.name} API error ${response.status}: ${errorText}`, {
            retryable: response.status >= 500 || response.status === 429,
            statusCode: response.status,
          }),
        );
      }

      const data = (await response.json()) as OpenAIResponse;
      return ok(this.parseResponse(data, model));
    } catch (cause) {
      return err(
        createError("provider", `${this.name} request failed`, { cause, retryable: true }),
      );
    }
  }

  private convertMessages(messages: Message[]): OpenAIMessage[] {
    return messages.map((msg) => {
      const base: OpenAIMessage = {
        role: msg.role,
        content: msg.content,
      };

      if (msg.role === "tool" && msg.toolCallId) {
        base.tool_call_id = msg.toolCallId;
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        base.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      return base;
    });
  }

  private convertTool(tool: ToolDefinition): OpenAITool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }

  private parseResponse(data: OpenAIResponse, model: string): CompletionResponse {
    const choice = data.choices[0];
    if (!choice) {
      return {
        content: "",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model,
        finishReason: "error",
      };
    }

    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice.message.content || "",
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      model,
      finishReason: choice.finish_reason === "tool_calls" ? "tool_calls" : "stop",
    };
  }

  static capabilities(name: string = "openai"): ProviderCapabilities {
    return {
      name,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: name === "openai",
      maxContextTokens: 128000,
      costTier: name === "deepseek" ? "low" : "high",
      strengthProfile: {
        reasoning: name === "deepseek" ? 8 : 9,
        coding: name === "deepseek" ? 8 : 9,
        creativity: 8,
        speed: name === "deepseek" ? 8 : 7,
        accuracy: 9,
      },
    };
  }
}

// ── OpenAI API types (minimal) ───────────────────────────────────────────────

interface OpenAIMessage {
  role: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  choices: {
    message: {
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
