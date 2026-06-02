import { OpenAIProvider } from "./openai.js";

export class MistralProvider extends OpenAIProvider {
  constructor(apiKey: string, baseUrl = "https://api.mistral.ai/v1") {
    super(apiKey, { name: "mistral", baseUrl, defaultModel: "mistral-large-latest" });
  }
}
