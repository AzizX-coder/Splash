import { OpenAIProvider } from "./openai.js";

export class NvidiaProvider extends OpenAIProvider {
  constructor(apiKey: string, baseUrl = "https://integrate.api.nvidia.com/v1") {
    super(apiKey, { name: "nvidia", baseUrl, defaultModel: "meta/llama3-70b-instruct" });
  }
}
