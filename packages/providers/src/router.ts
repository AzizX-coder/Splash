import type {
  SplashError,
  CompletionRequest,
  CompletionResponse,
  ProviderName,
  Result,
} from "@splash/utils";
import { err, createError, createLogger } from "@splash/utils";
import type { ModelProvider, ProviderCapabilities } from "./provider.js";
import { RoutingPolicy } from "./routing-policy.js";

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
  private stepUsage = new Map<string, { promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number }>();
  private circuitBreaker = new Map<
    string,
    { failures: number; openUntil: number; state: "open" | "half-open"; trialInFlight: boolean }
  >();
  private routingPolicy?: RoutingPolicy;

  // USD cost estimates per 1M tokens (prompt, completion) based on tier
  private static readonly COST_RATES = {
    free: { prompt: 0, completion: 0 },
    low: { prompt: 0.15, completion: 0.6 },
    medium: { prompt: 3.0, completion: 15.0 },
    high: { prompt: 15.0, completion: 75.0 },
  };

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

  /** Opt-in: install a task-type → provider routing policy (spec §2.3). */
  setRoutingPolicy(policy: RoutingPolicy): void {
    this.routingPolicy = policy;
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
   * Selects based on criteria, then walks the fallback chain, honoring the
   * per-provider circuit breaker (closed → open → half-open).
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

    // Ordered candidates: primary selection first, then available fallbacks.
    const candidates: ModelProvider[] = [provider];
    for (const name of this.fallbackOrder) {
      const p = this.getProvider(name);
      if (p && p.name !== provider.name && p.isAvailable() && !candidates.includes(p)) {
        candidates.push(p);
      }
    }

    let lastError: SplashError | undefined;
    for (const current of candidates) {
      if (!this.breakerAllows(current.name)) {
        log.warn(`Circuit breaker open for ${current.name}, skipping`);
        continue;
      }

      log.info("Routing request", { provider: current.name, criteria });
      const result = await current.complete(request);

      if (result.ok) {
        this.recordBreakerSuccess(current.name);
        result.value.providerUsed = current.name;
        return result;
      }

      if (this.isRetryableStatus(result.error)) {
        log.warn(
          `Provider ${current.name} failed with status ${result.error.statusCode ?? "?"}; advancing fallback`,
        );
        this.recordBreakerFailure(current.name);
        await this.logProviderError(current.name, result.error.message);
        lastError = result.error;
        continue;
      }

      // Non-retryable error means the provider responded (it is alive) → close breaker.
      this.recordBreakerSuccess(current.name);
      return result;
    }

    return err(
      createError(
        "provider",
        lastError
          ? `All providers exhausted. Last error: ${lastError.message}`
          : "All providers busy or circuit broken. Try again in 1 minute.",
      ),
    );
  }

  /** True for transient provider failures (rate limit / server errors). */
  private isRetryableStatus(error: SplashError): boolean {
    const code = error.statusCode;
    return code === 429 || (code !== undefined && code >= 500);
  }

  /** Circuit-breaker gate. Returns true if a request may be attempted. */
  private breakerAllows(name: string): boolean {
    const cb = this.circuitBreaker.get(name);
    if (!cb) return true; // closed
    const now = Date.now();
    if (cb.state === "open") {
      if (now >= cb.openUntil) {
        // Transition to half-open and allow exactly one trial request.
        cb.state = "half-open";
        cb.trialInFlight = true;
        return true;
      }
      return false;
    }
    // half-open: only one trial at a time
    if (cb.trialInFlight) return false;
    cb.trialInFlight = true;
    return true;
  }

  /** Success closes the breaker. */
  private recordBreakerSuccess(name: string): void {
    this.circuitBreaker.delete(name);
  }

  /** Failure (re)opens the breaker with exponential backoff + jitter. */
  private recordBreakerFailure(name: string): void {
    const failures = (this.circuitBreaker.get(name)?.failures || 0) + 1;
    const backoffMs = Math.min(60000, 2000 * Math.pow(2, failures)) + Math.random() * 1000;
    this.circuitBreaker.set(name, {
      failures,
      openUntil: Date.now() + backoffMs,
      state: "open",
      trialInFlight: false,
    });
  }

  private async logProviderError(provider: string, message: string): Promise<void> {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const os = await import("node:os");
      const errorLog = path.join(os.homedir(), ".splash", "logs", "error.jsonl");
      await fs.mkdir(path.dirname(errorLog), { recursive: true });
      await fs.appendFile(
        errorLog,
        JSON.stringify({ timestamp: new Date().toISOString(), provider, error: message }) + "\n",
        "utf-8",
      );
    } catch {
      // Best-effort logging; never block routing on a log write.
    }
  }

  /**
   * Route a step execution and track token usage automatically.
   */
  async routeStep(
    stepId: string,
    request: CompletionRequest,
    criteria?: RoutingCriteria,
  ): Promise<Result<CompletionResponse>> {
    const result = await this.route(request, criteria);
    if (result.ok && result.value.usage) {
      // Attribute cost to the provider that ACTUALLY served the request (after any fallback),
      // not the originally preferred/default provider.
      const providerName =
        result.value.providerUsed || criteria?.preferProvider || this.defaultProvider;
      const caps = this.capabilities.get(providerName);

      let costUsd = 0;
      if (caps && ProviderRouter.COST_RATES[caps.costTier]) {
        const rates = ProviderRouter.COST_RATES[caps.costTier];
        costUsd = (result.value.usage.promptTokens / 1_000_000) * rates.prompt + 
                  (result.value.usage.completionTokens / 1_000_000) * rates.completion;
      }

      const prev = this.stepUsage.get(stepId) || { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
      this.stepUsage.set(stepId, {
        promptTokens: prev.promptTokens + result.value.usage.promptTokens,
        completionTokens: prev.completionTokens + result.value.usage.completionTokens,
        totalTokens: prev.totalTokens + result.value.usage.totalTokens,
        costUsd: prev.costUsd + costUsd,
      });
    }
    return result;
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

    // Consult the routing policy (if installed): pick the first policy-preferred
    // provider that is registered, available, and meets hard requirements.
    if (this.routingPolicy) {
      const taskType = criteria?.requireVision ? "vision" : criteria?.taskType;
      for (const name of this.routingPolicy.resolve(taskType)) {
        const candidate = this.providers.get(name);
        if (!candidate || !candidate.isAvailable()) continue;
        const caps = this.capabilities.get(name);
        if (!caps) continue;
        if (criteria?.requireTools && !caps.supportsTools) continue;
        if (criteria?.requireVision && !caps.supportsVision) continue;
        if (criteria?.maxCostTier && !isCostWithinBudget(caps.costTier, criteria.maxCostTier)) continue;
        return candidate;
      }
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

  /** Record token usage for a specific step. */
  recordStepUsage(stepId: string, usage: { promptTokens: number; completionTokens: number; totalTokens: number; costUsd?: number }): void {
    const existing = this.stepUsage.get(stepId);
    if (existing) {
      existing.promptTokens += usage.promptTokens;
      existing.completionTokens += usage.completionTokens;
      existing.totalTokens += usage.totalTokens;
      existing.costUsd += (usage.costUsd || 0);
    } else {
      this.stepUsage.set(stepId, { ...usage, costUsd: usage.costUsd || 0 });
    }
  }

  /** Get token usage for a specific step. */
  getStepUsage(stepId: string): { promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number } | undefined {
    return this.stepUsage.get(stepId);
  }

  /** Get total token usage across all steps. */
  getTotalUsage(): { promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number } {
    let promptTokens = 0, completionTokens = 0, totalTokens = 0, costUsd = 0;
    for (const usage of this.stepUsage.values()) {
      promptTokens += usage.promptTokens;
      completionTokens += usage.completionTokens;
      totalTokens += usage.totalTokens;
      costUsd += usage.costUsd;
    }
    return { promptTokens, completionTokens, totalTokens, costUsd };
  }

  /** Reset all step usage tracking. */
  resetUsage(): void {
    this.stepUsage.clear();
  }
}

const COST_ORDER: Record<string, number> = { free: 0, low: 1, medium: 2, high: 3 };

function isCostWithinBudget(actual: string, max: string): boolean {
  return (COST_ORDER[actual] ?? 99) <= (COST_ORDER[max] ?? 99);
}
