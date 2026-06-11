import { OpenAIProvider } from "./openai.js";
import { readGlobalConfig } from "@alpclaw/config";

export class GroqProvider extends OpenAIProvider {
  constructor(apiKey?: string, baseUrl = "https://api.groq.com/openai/v1") {
    const key = apiKey || process.env.GROQ_API_KEY || readGlobalConfig().apiKeys?.groq;
    if (!key) throw new Error("[ERR] Not configured: Missing Groq API key");
    super(key, { name: "groq", baseUrl, defaultModel: "llama3-70b-8192" });
  }
}
