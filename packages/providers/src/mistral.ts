import { OpenAIProvider } from "./openai.js";
import { readGlobalConfig } from "@alpclaw/config";

export class MistralProvider extends OpenAIProvider {
  constructor(apiKey?: string, baseUrl = "https://api.mistral.ai/v1") {
    const key = apiKey || process.env.MISTRAL_API_KEY || readGlobalConfig().apiKeys?.mistral;
    if (!key) throw new Error("[ERR] Not configured: Missing Mistral API key");
    super(key, { name: "mistral", baseUrl, defaultModel: "mistral-large-latest" });
  }
}
