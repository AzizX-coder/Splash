import {
  type SafetyVerdict,
  type SafetyMode,
  type RiskLevel,
  createLogger,
} from "@splash/utils";
import { BUILT_IN_POLICIES, type SafetyPolicy } from "./policies.js";

const log = createLogger("safety");

const RISK_ORDER: Record<RiskLevel, number> = {
  safe: 0,
  moderate: 1,
  dangerous: 2,
  destructive: 3,
};

/**
 * SafetyEngine evaluates actions against registered policies
 * and returns a verdict indicating whether the action is allowed.
 */
export class SafetyEngine {
  private policies: SafetyPolicy[];
  private mode: SafetyMode;
  private customBlockedPatterns: RegExp[];

  constructor(mode: SafetyMode = "standard", blockedPatterns: string[] = []) {
    this.mode = mode;
    this.policies = [...BUILT_IN_POLICIES];
    this.customBlockedPatterns = blockedPatterns.map((p) => new RegExp(p, "i"));
  }

  /**
   * Evaluate an action string (command, tool input, etc.) against all policies.
   */
  evaluate(action: string, context?: string): SafetyVerdict {
    // Check custom blocked patterns first — always blocked
    for (const pattern of this.customBlockedPatterns) {
      if (pattern.test(action) || (context && pattern.test(context))) {
        log.warn("Action blocked by custom pattern", { action, pattern: pattern.source });
        return {
          allowed: false,
          reason: `Blocked by custom safety pattern: ${pattern.source}`,
          requiresConfirmation: false,
          riskLevel: "destructive",
        };
      }
    }

    // Evaluate against built-in policies
    let highestRisk: RiskLevel = "safe";
    const mitigations: string[] = [];
    const matchedPolicies: SafetyPolicy[] = [];

    for (const policy of this.policies) {
      if (!policy.activeModes.includes(this.mode)) continue;

      for (const pattern of policy.patterns) {
        const target = context ? `${action} ${context}` : action;
        if (pattern.test(target)) {
          matchedPolicies.push(policy);
          if (RISK_ORDER[policy.riskLevel] > RISK_ORDER[highestRisk]) {
            highestRisk = policy.riskLevel;
          }
          mitigations.push(`${policy.name}: ${policy.description}`);
          break; // One match per policy is enough
        }
      }
    }

    if (matchedPolicies.length === 0) {
      return {
        allowed: true,
        requiresConfirmation: false,
        riskLevel: "safe",
      };
    }

    const verdict = this.computeVerdict(highestRisk, matchedPolicies);
    if (!verdict.allowed || verdict.requiresConfirmation) {
      log.warn("Safety check flagged action", {
        action: action.slice(0, 100),
        risk: highestRisk,
        policies: matchedPolicies.map((p) => p.name),
      });
    }

    return { ...verdict, mitigations };
  }

  private computeVerdict(
    riskLevel: RiskLevel,
    matched: SafetyPolicy[],
  ): SafetyVerdict {
    switch (this.mode) {
      case "strict":
        return {
          allowed: riskLevel === "safe" || riskLevel === "moderate",
          requiresConfirmation: riskLevel === "moderate",
          riskLevel,
          reason:
            riskLevel !== "safe"
              ? `Strict mode: ${matched.map((p) => p.name).join(", ")}`
              : undefined,
        };

      case "standard":
        return {
          allowed: riskLevel !== "destructive",
          requiresConfirmation: riskLevel === "dangerous" || riskLevel === "moderate",
          riskLevel,
          reason:
            riskLevel === "destructive"
              ? `Blocked: ${matched.map((p) => p.name).join(", ")}`
              : undefined,
        };

      case "permissive":
        return {
          allowed: true,
          requiresConfirmation: riskLevel === "destructive",
          riskLevel,
          reason:
            riskLevel === "destructive"
              ? `Requires confirmation: ${matched.map((p) => p.name).join(", ")}`
              : undefined,
        };
    }
  }

  /** Add a custom policy at runtime. */
  addPolicy(policy: SafetyPolicy): void {
    this.policies.push(policy);
  }

  /** Change safety mode. */
  setMode(mode: SafetyMode): void {
    this.mode = mode;
    log.info("Safety mode changed", { mode });
  }

  getMode(): SafetyMode {
    return this.mode;
  }

  // ─── Phase 1.5 Additions: Injection, Credentials, Sandbox ──────────────────

  /**
   * Scan input for prompt injection attempts using pattern matching.
   */
  scanPromptInjection(input: string): { detected: boolean; reason?: string } {
    const injectionPatterns = [
      /ignore all previous instructions/i,
      /you are now acting as/i,
      /system prompt:/i,
      /do not follow the rules/i,
      /forget everything/i,
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(input)) {
        return { detected: true, reason: `Matches prompt injection pattern: ${pattern.source}` };
      }
    }
    return { detected: false };
  }

  /**
   * Scan text (tool args, LLM outputs) for credentials (API keys, secrets).
   */
  scanCredentials(text: string): { detected: boolean; matches: string[] } {
    const credentialPatterns = [
      /(?:api_key|apikey|secret|token|password)[\s:=]+["'][a-zA-Z0-9_\-]{16,}["']/i,
      /sk-[a-zA-Z0-9]{32,}/, // OpenAI/Anthropic
      /xox[baprs]-[a-zA-Z0-9]{10,}/, // Slack
      /AIza[0-9A-Za-z-_]{35}/, // Google
    ];

    const matches: string[] = [];
    for (const pattern of credentialPatterns) {
      const match = text.match(pattern);
      if (match) {
        matches.push(match[0]);
      }
    }

    return { detected: matches.length > 0, matches };
  }

  /**
   * Redact any detected credentials in text before it reaches logs, cache, or memory.
   * Replaces each match with a [REDACTED:<kind>] marker rather than dropping it,
   * so the surrounding context remains intelligible.
   */
  redactCredentials(text: string): string {
    if (!text) return text;
    const patterns: Array<{ re: RegExp; label: string }> = [
      { re: /(?:api_key|apikey|secret|token|password)[\s:=]+["'][a-zA-Z0-9_\-]{16,}["']/gi, label: "credential" },
      { re: /sk-[a-zA-Z0-9]{32,}/g, label: "openai-key" },
      { re: /xox[baprs]-[a-zA-Z0-9]{10,}/g, label: "slack-token" },
      { re: /AIza[0-9A-Za-z-_]{35}/g, label: "google-key" },
    ];
    let out = text;
    for (const { re, label } of patterns) {
      out = out.replace(re, `[REDACTED:${label}]`);
    }
    return out;
  }

  /**
   * Enforce filesystem sandbox (chroot) per skill.
   */
  resolveSandboxedPath(skillName: string, requestedPath: string, allowedDirs: string[]): string {
    const path = require("node:path");
    const os = require("node:os");

    const resolved = path.resolve(requestedPath);
    
    // Check if resolved path is within any of the allowed directories
    const isAllowed = allowedDirs.some((dir) => {
      const allowedResolved = path.resolve(dir);
      return resolved.startsWith(allowedResolved);
    });

    if (!isAllowed) {
      throw new Error(`[Security] Skill "${skillName}" attempted to access path outside allowed sandbox: ${resolved}`);
    }

    return resolved;
  }
}
