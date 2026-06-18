import type {
  CompletionRequest,
  CompletionResponse,
  ProviderName,
  Result,
} from "@splash/utils";

/**
 * Interface that all model providers must implement.
 */
export interface ModelProvider {
  readonly name: ProviderName;

  /** Check if the provider is configured and available. */
  isAvailable(): boolean;

  /** Healthcheck to ping the provider. */
  healthcheck(): Promise<boolean>;

  /** Send a completion request and get a response. */
  complete(request: CompletionRequest): Promise<Result<CompletionResponse>>;

  /** List available models from this provider. */
  listModels(): Promise<{ id: string; isFree: boolean; contextTokens?: number }[]>;
}

/**
 * Metadata about a provider, used for routing decisions.
 */
export interface ProviderCapabilities {
  name: ProviderName;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  maxContextTokens: number;
  costTier: "free" | "low" | "medium" | "high";
  strengthProfile: {
    reasoning: number; // 0-10
    coding: number;
    creativity: number;
    speed: number;
    accuracy: number;
  };
}
