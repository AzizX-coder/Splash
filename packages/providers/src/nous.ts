import { OpenAIProvider } from "./openai.js";
import type { ProviderCapabilities } from "./provider.js";
import { readGlobalConfig } from "@splash/config";

const NOUS_BASE_URL = "https://inference-api.nousresearch.com/v1";
const DEFAULT_MODEL = "nousresearch/hermes-3-llama-3.1-405b:free";

const NOUS_MODELS: Array<{ id: string; isFree: boolean; contextTokens?: number }> = [
  { id: "nousresearch/hermes-3-llama-3.1-405b:free", isFree: true, contextTokens: 131072 },
  { id: "nvidia/nemotron-3-ultra:free", isFree: true, contextTokens: 32768 },
  { id: "meta-llama/llama-3.1-70b-instruct", isFree: false, contextTokens: 131072 },
  { id: "nvidia/llama-3.1-nemotron-70b-instruct", isFree: false, contextTokens: 131072 },
  { id: "mistralai/mistral-7b-instruct-v0.3", isFree: false, contextTokens: 32768 },
];

/**
 * Nous Portal provider — OpenAI-compatible chat completions endpoint at
 * inference-api.nousresearch.com. Free tier available for select models.
 */
export class NousProvider extends OpenAIProvider {
  readonly name = "nous";

  constructor(apiKey?: string, baseUrl: string = NOUS_BASE_URL) {
    const key = apiKey || process.env.NOUS_API_KEY || readGlobalConfig().apiKeys?.nous;
    if (!key) throw new Error("[ERR] Not configured: Missing Nous API key");
    super(key, { name: "nous", baseUrl, defaultModel: DEFAULT_MODEL });
  }

  override async listModels(): Promise<{ id: string; isFree: boolean; contextTokens?: number }[]> {
    return NOUS_MODELS;
  }

  static capabilities(): ProviderCapabilities {
    return {
      name: "nous",
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      maxContextTokens: 131072,
      costTier: "free",
      strengthProfile: { reasoning: 8, coding: 7, creativity: 7, speed: 6, accuracy: 8 },
    };
  }
}
