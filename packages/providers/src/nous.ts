import type { CompletionRequest, CompletionResponse, Result } from "@alpclaw/utils";
import { err, createError } from "@alpclaw/utils";
import type { ModelProvider } from "./provider.js";

export class NousProvider implements ModelProvider {
  readonly name = "nous";
  constructor(private apiKey: string, private baseUrl = "https://api.nousresearch.com") {}

  isAvailable(): boolean { return this.apiKey.length > 0; }
  async healthcheck(): Promise<boolean> { return false; }
  async listModels(): Promise<{ id: string; isFree: boolean; contextTokens?: number }[]> { return []; }
  async complete(_req: CompletionRequest): Promise<Result<CompletionResponse>> {
    return err(createError("provider", "NousProvider not implemented"));
  }
}
