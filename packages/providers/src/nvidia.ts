import { OpenAIProvider } from "./openai.js";
import { readGlobalConfig } from "@alpclaw/config";

export class NvidiaProvider extends OpenAIProvider {
  constructor(apiKey?: string, baseUrl = "https://integrate.api.nvidia.com/v1") {
    const key = apiKey || process.env.NVIDIA_API_KEY || readGlobalConfig().apiKeys?.nvidia;
    if (!key) throw new Error("[ERR] Not configured: Missing Nvidia API key");
    super(key, { name: "nvidia", baseUrl, defaultModel: "meta/llama3-70b-instruct" });
  }
}
