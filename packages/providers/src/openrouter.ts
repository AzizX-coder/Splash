import { OpenAIProvider } from "./openai.js";
import { type ProviderCapabilities } from "./provider.js";

/**
 * OpenRouter Provider uses the OpenAI API format but routes to https://openrouter.ai.
 * This unlocks massive arrays of models like:
 * - qwen/qwen-2.5-72b-instruct (Alibaba/Qwen)
 * - deepseek/deepseek-chat (DeepSeek)
 * - zhipu/glm-4 (Zhipu AI)
 * - anthropic/claude-3-opus
 */
export class OpenRouterProvider extends OpenAIProvider {
  override readonly name = "openrouter";

  constructor(apiKey?: string, opts?: { defaultModel?: string }) {
    super(apiKey, {
      name: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: opts?.defaultModel || "moonshotai/kimi-k2",
    });
  }

  override async listModels(): Promise<{ id: string; isFree: boolean; contextTokens?: number }[]> {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models");
      if (!response.ok) return [];
      const data = (await response.json()) as any;
      return (data.data || []).map((model: any) => ({
        id: model.id,
        isFree: model.pricing?.prompt === "0",
        contextTokens: model.context_length,
      }));
    } catch {
      return [];
    }
  }

  static override capabilities(): ProviderCapabilities {
    return {
      name: "openrouter",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
      maxContextTokens: 128000,
      costTier: "medium",
      strengthProfile: {
        reasoning: 9,
        coding: 9,
        creativity: 8,
        speed: 7,
        accuracy: 9,
      },
    };
  }
}
