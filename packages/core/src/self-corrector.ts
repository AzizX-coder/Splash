import type { Message, Result, SplashError } from "@splash/utils";
import { ok, err, createError, createLogger } from "@splash/utils";
import type { ProviderRouter } from "@splash/providers";
import type { VerificationResult } from "./verifier.js";

const log = createLogger("core:corrector");

export interface CorrectionStrategy {
  action: "retry" | "adjust_params" | "use_different_tool" | "ask_user" | "abort";
  reasoning: string;
  adjustedParams?: Record<string, unknown>;
  alternativeTool?: string;
}

/**
 * SelfCorrector analyzes failures and determines the best correction strategy.
 */
export class SelfCorrector {
  constructor(private router: ProviderRouter) {}

  /**
   * Analyze a verification failure and propose a correction strategy.
   */
  async analyze(
    originalAction: string,
    originalParams: Record<string, unknown>,
    verification: VerificationResult,
    previousAttempts: number,
    error?: SplashError,
  ): Promise<Result<CorrectionStrategy>> {
    // Simple heuristic corrections first (no LLM needed)
    const quickFix = this.tryQuickFix(originalAction, verification, previousAttempts, error);
    if (quickFix) {
      log.info("Quick fix applied", { action: quickFix.action });
      return ok(quickFix);
    }

    // If we've already retried too many times, abort
    if (previousAttempts >= 3) {
      return ok({
        action: "abort",
        reasoning: `Failed after ${previousAttempts} attempts. Stopping to prevent infinite loop.`,
      });
    }

    // Use LLM for complex correction analysis
    return this.analyzeWithLLM(originalAction, originalParams, verification, error);
  }

  private tryQuickFix(
    action: string,
    verification: VerificationResult,
    attempts: number,
    error?: SplashError,
  ): CorrectionStrategy | null {
    // Retryable errors on first attempt → just retry
    if (error?.retryable && attempts === 0) {
      return {
        action: "retry",
        reasoning: `Retryable error (${error.kind}), attempting retry`,
      };
    }

    // Timeout → retry with longer timeout
    if (error?.kind === "timeout" && attempts < 2) {
      return {
        action: "adjust_params",
        reasoning: "Timed out, retrying with longer timeout",
        adjustedParams: { timeout: 60000 },
      };
    }

    return null;
  }

  private async analyzeWithLLM(
    originalAction: string,
    originalParams: Record<string, unknown>,
    verification: VerificationResult,
    error?: SplashError,
  ): Promise<Result<CorrectionStrategy>> {
    const prompt = `You are a self-correction module for an autonomous agent.

The agent attempted: ${originalAction}
With parameters: ${JSON.stringify(originalParams, null, 2)}

Issues found:
${verification.issues.map((i) => `- ${i}`).join("\n")}

Suggestions:
${verification.suggestions.map((s) => `- ${s}`).join("\n")}

${error ? `Error: ${error.message} (kind: ${error.kind}, retryable: ${error.retryable})` : ""}

Determine the best correction strategy. Respond with JSON:
{
  "action": "retry" | "adjust_params" | "use_different_tool" | "ask_user" | "abort",
  "reasoning": "why this strategy",
  "adjustedParams": { ... } // if action is adjust_params
  "alternativeTool": "..." // if action is use_different_tool
}`;

    const messages: Message[] = [
      { role: "system", content: "You are a precise diagnostic agent. Return only JSON." },
      { role: "user", content: prompt },
    ];

    const result = await this.router.route(
      { messages, temperature: 0.1, maxTokens: 500 },
      { taskType: "reasoning" },
    );

    if (!result.ok) {
      // Fallback if LLM fails
      return ok({
        action: "retry",
        reasoning: "LLM analysis failed, attempting simple retry",
      });
    }

    try {
      const jsonMatch = result.value.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return ok({ action: "retry", reasoning: "Could not parse correction strategy" });
      }
      return ok(JSON.parse(jsonMatch[0]) as CorrectionStrategy);
    } catch {
      return ok({ action: "retry", reasoning: "Parse error in correction strategy" });
    }
  }
}
