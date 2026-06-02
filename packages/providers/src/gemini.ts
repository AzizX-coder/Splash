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

const log = createLogger("provider:gemini");

/**
 * Google Gemini provider implementation.
 * Uses the Gemini REST API via fetch.
 */
export class GeminiProvider implements ModelProvider {
  readonly name = "gemini" as const;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl =
      baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async healthcheck(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/models?key=${this.apiKey}`;
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<{ id: string; isFree: boolean; contextTokens?: number }[]> {
    return Promise.resolve([
      { id: "gemini-2.5-pro", isFree: false },
      { id: "gemini-2.5-flash", isFree: false },
      { id: "gemini-2.0-flash", isFree: false },
    ]);
  }

  async complete(request: CompletionRequest): Promise<Result<CompletionResponse>> {
    try {
      const model = request.model || "gemini-2.5-flash";
      const contents = this.convertMessages(request.messages);

      const body: Record<string, unknown> = { contents };

      if (request.tools && request.tools.length > 0) {
        body.tools = [
          {
            function_declarations: request.tools.map((t) => this.convertTool(t)),
          },
        ];
      }

      const genConfig: Record<string, unknown> = {};
      if (request.maxTokens) genConfig.maxOutputTokens = request.maxTokens;
      if (request.temperature !== undefined) genConfig.temperature = request.temperature;
      if (request.stop) genConfig.stopSequences = request.stop;
      if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;

      // Extract system instruction
      const systemMsg = request.messages.find((m) => m.role === "system");
      if (systemMsg) {
        body.system_instruction = { parts: [{ text: systemMsg.content }] };
      }

      log.debug("Sending request to Gemini", { model });

      const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return err(
          createError("provider", `Gemini API error ${response.status}: ${errorText}`, {
            retryable: response.status >= 500 || response.status === 429,
          }),
        );
      }

      const data = (await response.json()) as GeminiResponse;
      return ok(this.parseResponse(data, model));
    } catch (cause) {
      return err(createError("provider", "Gemini request failed", { cause, retryable: true }));
    }
  }

  private convertMessages(messages: Message[]): GeminiContent[] {
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === "system") continue; // handled separately

      const role = msg.role === "assistant" ? "model" : "user";
      const parts: GeminiPart[] = [];

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: { name: tc.name, args: tc.arguments },
          });
        }
      }

      if (msg.role === "tool") {
        parts.push({
          functionResponse: {
            name: msg.toolCallId || "unknown",
            response: { result: msg.content },
          },
        });
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    return contents;
  }

  private convertTool(tool: ToolDefinition): GeminiFunctionDecl {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    };
  }

  private parseResponse(data: GeminiResponse, model: string): CompletionResponse {
    const candidate = data.candidates?.[0];
    if (!candidate) {
      return {
        content: "",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model,
        finishReason: "error",
      };
    }

    let content = "";
    const toolCalls: ToolCall[] = [];
    let tcIndex = 0;

    for (const part of candidate.content?.parts || []) {
      if (part.text) content += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini_tc_${tcIndex++}`,
          name: part.functionCall.name,
          arguments: (part.functionCall.args || {}) as Record<string, unknown>,
        });
      }
    }

    const usage = data.usageMetadata;
    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: usage?.promptTokenCount || 0,
        completionTokens: usage?.candidatesTokenCount || 0,
        totalTokens: usage?.totalTokenCount || 0,
      },
      model,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
    };
  }

  static capabilities(): ProviderCapabilities {
    return {
      name: "gemini",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
      maxContextTokens: 1000000,
      costTier: "medium",
      strengthProfile: {
        reasoning: 9,
        coding: 8,
        creativity: 8,
        speed: 9,
        accuracy: 8,
      },
    };
  }
}

// ── Gemini API types (minimal) ───────────────────────────────────────────────

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: unknown };
  functionResponse?: { name: string; response: unknown };
}

interface GeminiFunctionDecl {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts: GeminiPart[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}
