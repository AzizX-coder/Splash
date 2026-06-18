import { z } from "zod";

export const ConfigSchema = z.object({
  providers: z.object({
    default: z.string().default("openrouter"),
    defaultModel: z.string().default("moonshotai/kimi-k2"),
    apiKeys: z.record(z.string(), z.string()).default({}),
    fallbackOrder: z.array(z.string()).default([]),
  }),
  safety: z.object({
    mode: z.enum(["strict", "standard", "permissive"]).default("standard"),
    blockedPatterns: z.array(z.string()).default([]),
    requireConfirmation: z.array(z.string()).default([]),
  }),
  memory: z.object({
    storagePath: z.string().default(".splash/memory"),
    maxEntries: z.number().default(1000),
    ttlMs: z.number().default(7 * 24 * 60 * 60 * 1000), // 7 days
    semanticCache: z.boolean().default(false), // spec §7.2 — opt-in similarity cache
  }),
  agent: z.object({
    maxRetries: z.number().min(0).max(10).default(3),
    maxSteps: z.number().min(1).max(100).default(50),
    timeoutMs: z.number().default(5 * 60 * 1000), // 5 minutes
  }),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }),
  bots: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  mcpServers: z.record(z.string(), z.object({
    command: z.string(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).optional()
  })).default({})
});

export type SplashConfig = z.infer<typeof ConfigSchema>;
