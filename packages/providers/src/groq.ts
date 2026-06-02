import { OpenAIProvider } from "./openai.js";

export class GroqProvider extends OpenAIProvider {
  constructor(apiKey: string, baseUrl = "https://api.groq.com/openai/v1") {
    super(apiKey, { name: "groq", baseUrl, defaultModel: "llama3-70b-8192" });
  }
}
