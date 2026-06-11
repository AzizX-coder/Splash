import { config as loadDotenv } from "dotenv";
import { ConfigSchema, type AlpClawConfig } from "./schema.js";
import { readGlobalConfig } from "./global-store.js";
import { createError, type Result, ok, err } from "@alpclaw/utils";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export type AlpClawConfigOverrides = DeepPartial<AlpClawConfig>;

/**
 * Layered config, lowest → highest precedence:
 *   1. defaults (schema)
 *   2. ~/.alpclaw/config.json
 *   3. .env / process env
 *   4. explicit overrides passed to loadConfig()
 */
import * as fs from "node:fs";
import { globalConfigPath } from "./global-store.js";
import { ZodError } from "zod";

export function loadConfig(overrides?: AlpClawConfigOverrides): Result<AlpClawConfig> {
  loadDotenv();

  if (!fs.existsSync(globalConfigPath())) {
    console.error("[ERR] No config at ~/.splash/config.json — run splash init");
  }

  try {
    const global = readGlobalConfig();

    const globalLayer = {
      providers: {
        default: global.defaultProvider,
        defaultModel: global.defaultModel,
        apiKeys: global.apiKeys || {},
      },
      safety: { mode: global.safetyMode },
      bots: global.bots || {},
      mcpServers: global.mcpServers || {},
    };

    const envGet = (key: string): string | undefined =>
      process.env["SPLASH_" + key] || process.env["ALPCLAW_" + key];

    const envLayer = {
      providers: {
        default: envGet("DEFAULT_PROVIDER"),
        defaultModel: envGet("DEFAULT_MODEL"),
        apiKeys: extractApiKeys(),
      },
      safety: { mode: envGet("SAFETY_MODE") },
      memory: { storagePath: envGet("MEMORY_PATH") },
      agent: { maxRetries: envGet("MAX_RETRIES") ? parseInt(envGet("MAX_RETRIES")!, 10) : undefined },
      logging: { level: envGet("LOG_LEVEL") },
    };

    const layered = deepMerge(deepMerge(globalLayer, envLayer), (overrides || {}) as Record<string, unknown>);
    const cleaned = dropUndefined(layered);
    const parsed = ConfigSchema.parse(cleaned);
    return ok(parsed);
  } catch (cause) {
    if (cause instanceof ZodError) {
      const issues = cause.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      console.error(`[ERR] Invalid config: ${issues}`);
      return err(createError("config", `Invalid config: ${issues}`, { cause }));
    }
    return err(createError("config", "Failed to load configuration", { cause }));
  }
}

function extractApiKeys(): Record<string, string> {
  const keys: Record<string, string> = {};
  const mapping: Record<string, string> = {
    ANTHROPIC_API_KEY: "claude",
    OPENAI_API_KEY: "openai",
    GOOGLE_API_KEY: "gemini",
    DEEPSEEK_API_KEY: "deepseek",
    OPENROUTER_API_KEY: "openrouter",
  };

  for (const [envVar, provider] of Object.entries(mapping)) {
    const value = process.env[envVar];
    if (value) keys[provider] = value;
  }

  return keys;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }
  return result;
}

function dropUndefined(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = dropUndefined(v);
  }
  return out;
}
