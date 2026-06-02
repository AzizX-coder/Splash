import { OpenAIProvider } from "./openai.js";

export class CerebrasProvider extends OpenAIProvider {
  constructor(apiKey: string, baseUrl = "https://api.cerebras.ai/v1") {
    super(apiKey, { name: "cerebras", baseUrl, defaultModel: "llama3.1-8b" });
  }
}
