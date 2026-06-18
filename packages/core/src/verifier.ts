import type { Result, SplashError } from "@splash/utils";
import { ok, err, createError, createLogger } from "@splash/utils";

const log = createLogger("core:verifier");

export interface VerificationResult {
  passed: boolean;
  issues: string[];
  suggestions: string[];
}

// ─── Multi-strategy verification (spec §2.4) ─────────────────────────────────

/** A verification strategy applied to a step/contract output. */
export type VerifierStrategy =
  | { type: "exact"; expected: string }
  | { type: "contains"; expected: string }
  | { type: "semantic"; expected: string; threshold?: number }
  | { type: "schema"; schema: Record<string, unknown> }
  | { type: "function"; fn: (output: unknown) => boolean };

/** A weighted, strategy-backed success criterion. */
export interface WeightedCriterion {
  name: string;
  strategy: VerifierStrategy;
  weight?: number; // default 1
}

export interface CriterionResult {
  name: string;
  passed: boolean;
  weight: number;
  detail: string;
}

export interface WeightedVerification {
  passed: boolean;   // all criteria passed
  score: number;     // 0..1 weighted pass ratio (partial credit)
  results: CriterionResult[];
}

/**
 * Verifier checks execution results for correctness and safety.
 */
export class Verifier {
  /**
   * Verify the output of a tool execution.
   */
  verifyToolOutput(
    toolName: string,
    input: Record<string, unknown>,
    output: unknown,
    error?: SplashError,
    strategy?: "exact" | "schema" | "semantic" | "custom",
    strategyOptions?: any
  ): VerificationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check for errors
    if (error) {
      issues.push(`Tool ${toolName} returned error: ${error.message}`);
      if (error.retryable) {
        suggestions.push("Error is retryable — consider retrying with same or adjusted parameters");
      } else {
        suggestions.push("Error is not retryable — try a different approach");
      }
    }

    // Check for empty/null output when not expected
    if (!error && (output === null || output === undefined)) {
      issues.push(`Tool ${toolName} returned null/undefined output`);
      suggestions.push("Check if the tool parameters are correct");
    }

    // Check for command execution results
    if (toolName.startsWith("terminal")) {
      const cmdResult = output as { exitCode?: number; stderr?: string } | null;
      if (cmdResult?.exitCode && cmdResult.exitCode !== 0) {
        issues.push(`Command failed with exit code ${cmdResult.exitCode}`);
        if (cmdResult.stderr) {
          issues.push(`stderr: ${cmdResult.stderr.slice(0, 200)}`);
        }
        suggestions.push("Review command output and adjust");
      }
    }

    if (issues.length === 0 && strategy) {
      if (strategy === "exact" && output !== strategyOptions?.expected) {
        issues.push(`Exact match failed. Expected: ${strategyOptions.expected}, Got: ${output}`);
        suggestions.push("Check formatting or exact character sequence");
      } else if (strategy === "schema") {
        if (typeof output !== "object" || output === null) {
          issues.push("Schema verification failed: output is not an object");
        }
        // Basic schema check could be done here based on strategyOptions.schema
      } else if (strategy === "semantic") {
        if (typeof output === "string" && strategyOptions?.expected && !output.includes(strategyOptions.expected)) {
          issues.push("Semantic verification failed (simulated with basic includes check).");
        }
      } else if (strategy === "custom" && typeof strategyOptions?.validator === "function") {
        if (!strategyOptions.validator(output)) {
          issues.push("Custom validation function rejected the output.");
        }
      }
    }

    const passed = issues.length === 0;
    if (!passed) {
      log.warn("Verification failed", { toolName, issueCount: issues.length });
    }

    return { passed, issues, suggestions };
  }

  /**
   * Verify a task's overall completion.
   */
  verifyTaskCompletion(
    taskDescription: string,
    stepResults: { description: string; success: boolean; output?: unknown }[],
  ): VerificationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];

    const failedSteps = stepResults.filter((s) => !s.success);
    if (failedSteps.length > 0) {
      for (const step of failedSteps) {
        issues.push(`Step failed: ${step.description}`);
      }
      suggestions.push("Address failed steps before marking task complete");
    }

    if (stepResults.length === 0) {
      issues.push("No steps were executed");
      suggestions.push("Ensure the plan has actionable steps");
    }

    return { passed: issues.length === 0, issues, suggestions };
  }

  // ─── Multi-strategy verification (spec §2.4) ───────────────────────────────

  /**
   * Verify an output against weighted, strategy-backed criteria.
   * Returns a pass/fail plus a 0..1 weighted score for partial-credit reporting.
   * `semantic` uses a deterministic token-overlap approximation here; true
   * embedding similarity is layered in by T2.2 without changing this API.
   */
  verifyWeighted(criteria: WeightedCriterion[], output: unknown): WeightedVerification {
    if (criteria.length === 0) {
      return { passed: true, score: 1, results: [] };
    }

    const results: CriterionResult[] = [];
    let totalWeight = 0;
    let passedWeight = 0;

    for (const criterion of criteria) {
      const weight = criterion.weight ?? 1;
      totalWeight += weight;
      const { passed, detail } = this.evaluateStrategy(criterion.strategy, output);
      if (passed) passedWeight += weight;
      results.push({ name: criterion.name, passed, weight, detail });
    }

    const score = totalWeight > 0 ? passedWeight / totalWeight : 1;
    const passed = results.every((r) => r.passed);
    if (!passed) {
      log.warn("Weighted verification failed", { score: score.toFixed(2), failed: results.filter((r) => !r.passed).map((r) => r.name) });
    }
    return { passed, score, results };
  }

  private evaluateStrategy(strategy: VerifierStrategy, output: unknown): { passed: boolean; detail: string } {
    const text = typeof output === "string" ? output : JSON.stringify(output ?? "");

    switch (strategy.type) {
      case "exact":
        return { passed: text.trim() === strategy.expected.trim(), detail: `exact match against "${strategy.expected.slice(0, 40)}"` };

      case "contains":
        return { passed: text.toLowerCase().includes(strategy.expected.toLowerCase()), detail: `contains "${strategy.expected.slice(0, 40)}"` };

      case "semantic": {
        const threshold = strategy.threshold ?? 0.85;
        const sim = this.tokenSimilarity(text, strategy.expected);
        return { passed: sim >= threshold, detail: `semantic similarity ${sim.toFixed(2)} >= ${threshold}` };
      }

      case "schema":
        return this.validateSchema(strategy.schema, output);

      case "function":
        try {
          return { passed: !!strategy.fn(output), detail: "custom function" };
        } catch (e) {
          return { passed: false, detail: `function threw: ${String(e)}` };
        }
    }
  }

  /** Jaccard token overlap — a deterministic stand-in for embedding similarity. */
  private tokenSimilarity(a: string, b: string): number {
    const norm = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 1));
    const sa = norm(a);
    const sb = norm(b);
    if (sa.size === 0 && sb.size === 0) return 1;
    let inter = 0;
    for (const t of sa) if (sb.has(t)) inter++;
    const union = sa.size + sb.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  /** Minimal JSON-Schema check: type, required keys, and property types. */
  private validateSchema(schema: Record<string, unknown>, output: unknown): { passed: boolean; detail: string } {
    let value: unknown = output;
    if (typeof output === "string") {
      try {
        value = JSON.parse(output);
      } catch {
        // leave as string; type check below will handle it
      }
    }

    const expectedType = schema["type"] as string | undefined;
    if (expectedType && !this.matchesType(value, expectedType)) {
      return { passed: false, detail: `expected type ${expectedType}, got ${Array.isArray(value) ? "array" : typeof value}` };
    }

    if (expectedType === "object" && value && typeof value === "object") {
      const required = (schema["required"] as string[] | undefined) ?? [];
      for (const key of required) {
        if (!(key in (value as Record<string, unknown>))) {
          return { passed: false, detail: `missing required key "${key}"` };
        }
      }
      const props = schema["properties"] as Record<string, { type?: string }> | undefined;
      if (props) {
        for (const [key, def] of Object.entries(props)) {
          const v = (value as Record<string, unknown>)[key];
          if (v !== undefined && def.type && !this.matchesType(v, def.type)) {
            return { passed: false, detail: `property "${key}" expected ${def.type}` };
          }
        }
      }
    }

    return { passed: true, detail: "schema valid" };
  }

  private matchesType(value: unknown, type: string): boolean {
    switch (type) {
      case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
      case "array": return Array.isArray(value);
      case "string": return typeof value === "string";
      case "number": case "integer": return typeof value === "number";
      case "boolean": return typeof value === "boolean";
      case "null": return value === null;
      default: return true;
    }
  }
}
