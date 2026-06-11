import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Persistent user config lives at ~/.splash/config.json so `splash` works
 * from any working directory without a local .env file.
 *
 * Legacy ~/.alpclaw/ is auto-migrated on first read.
 */

export interface GlobalConfigShape {
  defaultProvider?: string;
  defaultModel?: string;
  safetyMode?: "strict" | "standard" | "permissive";
  safety?: {
    mode?: "strict" | "standard" | "permissive";
    blockedPatterns?: string[];
  };
  providers?: {
    default?: string;
    apiKeys?: Record<string, string>;
    fallbackOrder?: string[];
  };
  runtime?: "foreground" | "background";
  tui?: boolean;
  preset?: "fast" | "balanced" | "safe";
  apiKeys?: Record<string, string>;
  bots?: Record<string, Record<string, string>>;
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  cli?: {
    style?: "splash" | "hydro" | "edge" | "silent";
    showThinking?: boolean;
    showToolUse?: boolean;
    timestamp?: boolean;
    colors?: boolean;
  };
}

export function globalConfigDir(): string {
  return path.join(os.homedir(), ".splash");
}

export function legacyConfigDir(): string {
  return path.join(os.homedir(), ".alpclaw");
}

export function globalConfigPath(): string {
  return path.join(globalConfigDir(), "config.json");
}

export function runsDir(): string {
  return path.join(globalConfigDir(), "runs");
}

export function logsDir(): string {
  return path.join(globalConfigDir(), "logs");
}

function migrateFromLegacy(): void {
  const legacy = legacyConfigDir();
  const current = globalConfigDir();
  if (!fs.existsSync(legacy) || fs.existsSync(current)) return;
  try {
    fs.mkdirSync(current, { recursive: true, mode: 0o700 });
    const legacyCfg = path.join(legacy, "config.json");
    if (fs.existsSync(legacyCfg)) {
      fs.copyFileSync(legacyCfg, path.join(current, "config.json"));
    }
  } catch {
    // Migration is best-effort; ignore failures.
  }
}

export function readGlobalConfig(): GlobalConfigShape {
  migrateFromLegacy();
  const p = globalConfigPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as GlobalConfigShape;
  } catch {
    return {};
  }
}

export function writeGlobalConfig(cfg: GlobalConfigShape): void {
  const dir = globalConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = globalConfigPath();
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function setGlobalValue<K extends keyof GlobalConfigShape>(
  key: K,
  value: GlobalConfigShape[K],
): void {
  const cfg = readGlobalConfig();
  cfg[key] = value;
  writeGlobalConfig(cfg);
}

export function setApiKey(provider: string, key: string): void {
  const cfg = readGlobalConfig();
  cfg.apiKeys = { ...(cfg.apiKeys || {}), [provider]: key };
  writeGlobalConfig(cfg);
}

export function setBotCredential(bot: string, field: string, value: string): void {
  const cfg = readGlobalConfig();
  cfg.bots = { ...(cfg.bots || {}) };
  cfg.bots[bot] = { ...(cfg.bots[bot] || {}), [field]: value };
  writeGlobalConfig(cfg);
}

/** Apply a config preset. fast = speed, safe = strict, balanced = default. */
export function applyPreset(name: "fast" | "balanced" | "safe"): GlobalConfigShape {
  const cfg = readGlobalConfig();
  cfg.preset = name;
  switch (name) {
    case "fast":
      cfg.safetyMode = "permissive";
      cfg.defaultModel = cfg.defaultModel || "moonshotai/kimi-k2";
      cfg.runtime = "foreground";
      break;
    case "safe":
      cfg.safetyMode = "strict";
      cfg.runtime = "foreground";
      break;
    case "balanced":
    default:
      cfg.safetyMode = "standard";
      cfg.runtime = "foreground";
      break;
  }
  writeGlobalConfig(cfg);
  return cfg;
}
