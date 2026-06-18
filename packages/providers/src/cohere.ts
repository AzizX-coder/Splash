import type { CompletionRequest, CompletionResponse, Result, Message } from "@splash/utils";
import { err, ok, createError, createLogger } from "@splash/utils";
import type { ModelProvider, ProviderCapabilities } from "./provider.js";
import { readGlobalConfig } from "@splash/config";

const log = createLogger("provider:cohere");

export class CohereProvider implements ModelProvider {
  readonly name = "cohere";
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl = "https://api.cohere.ai/v1") {
    const key = apiKey || process.env.COHERE_API_KEY || readGlobalConfig().apiKeys?.cohere;
    if (!key) throw new Error("[ERR] Not configured: Missing Cohere API key");
    this.apiKey = key;
    this.baseUrl = baseUrl;
  }

  isAvailable(): boolean { return this.apiKey.length > 0; }
  
  async healthcheck(): Promise<boolean> { 
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<{ id: string; isFree: boolean; contextTokens?: number }[]> { 
    return [
      { id: "command-r-plus", isFree: false, contextTokens: 128000 },
      { id: "command-r", isFree: false, contextTokens: 128000 }
    ]; 
  }

  async complete(request: CompletionRequest): Promise<Result<CompletionResponse>> {
    try {
      const model = request.model || "command-r-plus";
      const chatHistory = request.messages.slice(0, -1).map(m => ({
        role: m.role === "assistant" ? "CHATBOT" : m.role === "system" ? "SYSTEM" : "USER",
        message: m.content
      }));
      const message = request.messages[request.messages.length - 1]?.content || "";

      const body: Record<string, unknown> = {
        model,
        message,
        chat_history: chatHistory.length > 0 ? chatHistory : undefined,
      };

      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.stop) body.stop_sequences = request.stop;
      
      // We aren't implementing Cohere's tool calling dialect here since OpenAI provider is preferred for tools,
      // but we return real HTTP success.

      const response = await fetch(`${this.baseUrl}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return err(createError("provider", `Cohere API error ${response.status}: ${errorText}`, {
          retryable: response.status >= 500 || response.status === 429
        }));
      }

      const data = await response.json() as any;
      
      return ok({
        content: data.text || "",
        usage: {
          promptTokens: data.meta?.billed_units?.input_tokens || 0,
          completionTokens: data.meta?.billed_units?.output_tokens || 0,
          totalTokens: (data.meta?.billed_units?.input_tokens || 0) + (data.meta?.billed_units?.output_tokens || 0)
        },
        model,
        finishReason: "stop"
      });

    } catch (cause) {
      return err(createError("provider", "Cohere request failed", { cause, retryable: true }));
    }
  }

  static capabilities(): ProviderCapabilities {
    return {
      name: "cohere",
      supportsTools: false,
      supportsStreaming: true,
      supportsVision: false,
      maxContextTokens: 128000,
      costTier: "medium",
      strengthProfile: {
        reasoning: 8,
        coding: 7,
        creativity: 8,
        speed: 8,
        accuracy: 8
      }
    };
  }
}
