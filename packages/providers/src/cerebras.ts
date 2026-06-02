import type { CompletionRequest, CompletionResponse, Result } from "@alpclaw/utils";
import { err, createError } from "@alpclaw/utils";
import type { ModelProvider } from "./provider.js";

export class CerebrasProvider implements ModelProvider {
  readonly name = "cerebras";
  constructor(private apiKey: string, private baseUrl = "https://api.cerebras.ai/v1") {}

  isAvailable(): boolean { return this.apiKey.length > 0; }
  async healthcheck(): Promise<boolean> { return false; }
  async listModels(): Promise<{ id: string; isFree: boolean; contextTokens?: number }[]> { return []; }
  async complete(_req: CompletionRequest): Promise<Result<CompletionResponse>> {
    return err(createError("provider", "CerebrasProvider not implemented"));
  }
}
