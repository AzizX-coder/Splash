import type { RiskLevel, SafetyMode } from "@splash/utils";

/**
 * Built-in safety policies that define what actions require confirmation
 * or are blocked entirely.
 */

export interface SafetyPolicy {
  name: string;
  description: string;
  /** Patterns that match action names or arguments */
  patterns: RegExp[];
  /** Risk level assigned when matched */
  riskLevel: RiskLevel;
  /** In which safety modes is this policy active? */
  activeModes: SafetyMode[];
}

export const BUILT_IN_POLICIES: SafetyPolicy[] = [
  // ── Destructive file operations ──────────────────────────────────────────
  {
    name: "destructive-file-ops",
    description: "Block or warn on destructive file operations",
    patterns: [/rm\s+-rf/, /rmdir/, /del\s+\/s/, /format\s+/, /unlink/],
    riskLevel: "destructive",
    activeModes: ["strict", "standard", "permissive"],
  },
  // ── Force push / destructive git ─────────────────────────────────────────
  {
    name: "destructive-git",
    description: "Block force push, hard reset, branch deletion",
    patterns: [
      /git\s+push\s+.*--force/,
      /git\s+reset\s+--hard/,
      /git\s+clean\s+-f/,
      /git\s+branch\s+-D/,
    ],
    riskLevel: "destructive",
    activeModes: ["strict", "standard", "permissive"],
  },
  // ── Secret leakage ──────────────────────────────────────────────────────
  {
    name: "secret-leakage",
    description: "Prevent accidental exposure of secrets",
    patterns: [
      /\.env(?!\.example)/,
      /credentials\.json/,
      /secret/i,
      /password\s*=\s*['"]/,
      /api[_-]?key\s*=\s*['"]/,
      /\.ssh\/id_/,
      /\.pem\b/,
      /private[_-]?key/i,
    ],
    riskLevel: "dangerous",
    activeModes: ["strict", "standard"],
  },
  // ── Network / external calls ────────────────────────────────────────────
  {
    name: "external-network",
    description: "Flag external network calls that could leak data",
    patterns: [/curl\s+.*-d/, /wget\s+--post/, /fetch\(/, /axios\.post/],
    riskLevel: "moderate",
    activeModes: ["strict"],
  },
  // ── Database mutations ──────────────────────────────────────────────────
  {
    name: "database-mutations",
    description: "Flag database mutation operations",
    patterns: [/DROP\s+TABLE/i, /DELETE\s+FROM/i, /TRUNCATE/i, /ALTER\s+TABLE/i],
    riskLevel: "dangerous",
    activeModes: ["strict", "standard"],
  },
  // ── Process / system commands ───────────────────────────────────────────
  {
    name: "system-commands",
    description: "Flag dangerous system commands",
    patterns: [/kill\s+-9/, /shutdown/, /reboot/, /systemctl\s+stop/, /pkill/],
    riskLevel: "destructive",
    activeModes: ["strict", "standard", "permissive"],
  },
];
