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
  }),
  agent: z.object({
    maxRetries: z.number().min(0).max(10).default(3),
    maxSteps: z.number().min(1).max(100).default(50),
    timeoutMs: z.number().default(5 * 60 * 1000), // 5 minutes
  }),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }),
});

export type AlpClawConfig = z.infer<typeof ConfigSchema>;
