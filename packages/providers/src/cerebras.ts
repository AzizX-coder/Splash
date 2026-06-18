import { OpenAIProvider } from "./openai.js";
import { readGlobalConfig } from "@splash/config";

export class CerebrasProvider extends OpenAIProvider {
  constructor(apiKey?: string, baseUrl = "https://api.cerebras.ai/v1") {
    const key = apiKey || process.env.CEREBRAS_API_KEY || readGlobalConfig().apiKeys?.cerebras;
    if (!key) throw new Error("[ERR] Not configured: Missing Cerebras API key");
    super(key, { name: "cerebras", baseUrl, defaultModel: "llama3.1-8b" });
  }
}
