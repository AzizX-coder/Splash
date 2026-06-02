import type {
  CompletionRequest,
  CompletionResponse,
  ProviderName,
  Result,
} from "@alpclaw/utils";
import { err, createError, createLogger } from "@alpclaw/utils";
import type { ModelProvider, ProviderCapabilities } from "./provider.js";

const log = createLogger("provider:router");

/**
 * Criteria for selecting a provider.
 * The router uses these to pick the best provider for a given task.
 */
export interface RoutingCriteria {
  /** Prefer a specific provider by name. */
  preferProvider?: ProviderName;
  /** Task type hint for capability matching. */
  taskType?: "reasoning" | "coding" | "creative" | "fast" | "cheap";
  /** Require tool/function calling support. */
  requireTools?: boolean;
  /** Require vision support. */
  requireVision?: boolean;
  /** Maximum cost tier. */
  maxCostTier?: "free" | "low" | "medium" | "high";
}

/**
 * ProviderRouter manages multiple providers and routes requests
 * to the best available provider based on criteria.
 */
export class ProviderRouter {
  private providers = new Map<string, ModelProvider>();
  private capabilities = new Map<string, ProviderCapabilities>();
  private defaultProvider: string;
  private fallbackOrder: string[];

  constructor(defaultProvider: string = "claude", fallbackOrder: string[] = []) {
    this.defaultProvider = defaultProvider;
    this.fallbackOrder = fallbackOrder;
  }

  /** Register a provider with its capabilities. */
  register(provider: ModelProvider, capabilities: ProviderCapabilities): void {
    this.providers.set(provider.name, provider);
    this.capabilities.set(provider.name, capabilities);
    log.info("Provider registered", { name: provider.name, available: provider.isAvailable() });
  }

  /** Get a provider by name. */
  getProvider(name: string): ModelProvider | undefined {
    return this.providers.get(name);
  }

  /** List all registered providers with their instances and capabilities. */
  listProviders(): { name: string; available: boolean; provider: ModelProvider; capabilities: ProviderCapabilities }[] {
    return Array.from(this.providers.entries()).map(([name, provider]) => ({
      name,
      available: provider.isAvailable(),
      provider,
      capabilities: this.capabilities.get(name)!,
    }));
  }

  /**
   * Route a completion request to the best provider.
   * Selects based on criteria, availability, and capabilities.
   */
  async route(
    request: CompletionRequest,
    criteria?: RoutingCriteria,
  ): Promise<Result<CompletionResponse>> {
    const provider = this.selectProvider(criteria);
    if (!provider) {
      return err(
        createError("provider", "No suitable provider available for the given criteria"),
      );
    }

    let currentProvider = provider;
    let attempts = 0;
    const maxAttempts = this.fallbackOrder.length + 1; // initial + fallbacks
    let fallbackIndex = 0;

    while (attempts < maxAttempts) {
      log.info("Routing request", { provider: currentProvider.name, criteria });
      const result = await currentProvider.complete(request);
      
      if (!result.ok && result.error.message.includes("429")) {
        log.warn(`Provider ${currentProvider.name} returned 429 Rate Limit.`);
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const os = await import("node:os");
        const errorLog = path.join(os.homedir(), ".splash", "logs", "error.jsonl");
        await fs.mkdir(path.dirname(errorLog), { recursive: true }).catch(() => {});
        await fs.appendFile(errorLog, JSON.stringify({ timestamp: new Date().toISOString(), provider: currentProvider.name, error: result.error.message }) + "\n", "utf-8").catch(() => {});

        // Find next available fallback
        while (fallbackIndex < this.fallbackOrder.length) {
          const nextName = this.fallbackOrder[fallbackIndex++];
          if (!nextName) break;
          const nextProv = this.getProvider(nextName);
          if (nextProv && nextProv.isAvailable()) {
             currentProvider = nextProv;
             break;
          }
        }
        
        if (currentProvider.name !== provider.name && fallbackIndex <= this.fallbackOrder.length) {
          attempts++;
          continue; // Try again with new provider
        }
      } else if (!result.ok) {
        return result; // Other errors return immediately
      }
      
      return result; // Success
    }

    return err(createError("provider", "All providers busy. Try again in 1 minute."));
  }

  /**
   * Select the best provider for given criteria.
   */
  selectProvider(criteria?: RoutingCriteria): ModelProvider | undefined {
    // If a specific provider is preferred and available, use it
    if (criteria?.preferProvider) {
      const preferred = this.providers.get(criteria.preferProvider);
      if (preferred?.isAvailable()) return preferred;
      log.warn("Preferred provider unavailable, falling back", {
        preferred: criteria.preferProvider,
      });
    }

    // Score all available providers
    const scored: { provider: ModelProvider; score: number }[] = [];

    for (const [name, provider] of this.providers) {
      if (!provider.isAvailable()) continue;

      const caps = this.capabilities.get(name);
      if (!caps) continue;

      // Hard requirements
      if (criteria?.requireTools && !caps.supportsTools) continue;
      if (criteria?.requireVision && !caps.supportsVision) continue;
      if (criteria?.maxCostTier && !isCostWithinBudget(caps.costTier, criteria.maxCostTier))
        continue;

      // Soft scoring
      let score = 5; // base score
      if (name === this.defaultProvider) score += 2;

      if (criteria?.taskType) {
        const strengthMap: Record<string, keyof ProviderCapabilities["strengthProfile"]> = {
          reasoning: "reasoning",
          coding: "coding",
          creative: "creativity",
          fast: "speed",
          cheap: "accuracy", // fallback
        };
        const key = strengthMap[criteria.taskType];
        if (key) score += caps.strengthProfile[key];
      } else {
        // No task type specified, use overall average
        const avg =
          Object.values(caps.strengthProfile).reduce((a, b) => a + b, 0) /
          Object.values(caps.strengthProfile).length;
        score += avg;
      }

      scored.push({ provider, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.provider;
  }
}

const COST_ORDER: Record<string, number> = { free: 0, low: 1, medium: 2, high: 3 };

function isCostWithinBudget(actual: string, max: string): boolean {
  return (COST_ORDER[actual] ?? 99) <= (COST_ORDER[max] ?? 99);
}
