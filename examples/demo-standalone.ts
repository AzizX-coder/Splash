#!/usr/bin/env tsx

/**
 * Splash standalone demo — shows how to use individual packages
 * without the full agent loop. Useful for understanding the architecture.
 */

import { SafetyEngine } from "@splash/safety";
import { FileMemoryStore, MemoryManager } from "@splash/memory";
import { ConnectorRegistry, FilesystemConnector, TerminalConnector } from "@splash/connectors";
import { SkillRegistry, RepoAnalysisSkill, CodeEditSkill } from "@splash/skills";
import { ProviderRouter, ClaudeProvider, OpenAIProvider } from "@splash/providers";
import { createLogger } from "@splash/utils";

const log = createLogger("demo");

async function main() {
  console.log("=== Splash Standalone Demo ===\n");

  // ── 1. Safety Engine ────────────────────────────────────────────────────
  console.log("--- Safety Engine ---");
  const safety = new SafetyEngine("standard");

  const tests = [
    "ls -la /home/user",
    "rm -rf /",
    "git push --force origin main",
    "SELECT * FROM users",
    "DROP TABLE users",
    "cat ~/.ssh/id_rsa",
  ];

  for (const test of tests) {
    const verdict = safety.evaluate(test);
    const icon = verdict.allowed ? (verdict.requiresConfirmation ? "⚠" : "✓") : "✗";
    console.log(`  ${icon} "${test}" → ${verdict.riskLevel}${verdict.reason ? ` (${verdict.reason})` : ""}`);
  }

  // ── 2. Memory System ───────────────────────────────────────────────────
  console.log("\n--- Memory System ---");
  const memStore = new FileMemoryStore(".splash/demo-memory");
  const memory = new MemoryManager(memStore);

  await memory.remember("project", "tech-stack", "TypeScript + pnpm monorepo");
  await memory.remember("decision", "provider-choice", "Claude as default, OpenAI as fallback");
  await memory.remember("user", "preference", "Prefers concise output");

  const recalled = await memory.recall("project");
  if (recalled.ok) {
    console.log(`  Stored ${recalled.value.length} project memories`);
    for (const entry of recalled.value) {
      console.log(`  - [${entry.category}:${entry.key}] ${entry.value}`);
    }
  }

  const searched = await memory.search("TypeScript");
  if (searched.ok) {
    console.log(`  Search "TypeScript": ${searched.value.length} results`);
  }

  // ── 3. Connectors ──────────────────────────────────────────────────────
  console.log("\n--- Connectors ---");
  const registry = new ConnectorRegistry();
  registry.register(new FilesystemConnector());
  registry.register(new TerminalConnector());

  const fs = registry.get("fs")!;
  const result = await fs.execute("list", { path: "." });
  if (result.ok) {
    const files = result.value as string[];
    console.log(`  Listed ${files.length} entries in current directory`);
    for (const f of files.slice(0, 5)) {
      console.log(`    ${f}`);
    }
    if (files.length > 5) console.log(`    ... and ${files.length - 5} more`);
  }

  const terminal = registry.get("terminal")!;
  const nodeResult = await terminal.execute("run", { command: "node --version" });
  if (nodeResult.ok) {
    const out = nodeResult.value as { stdout: string };
    console.log(`  Node version: ${out.stdout.trim()}`);
  }

  // ── 4. Tool Definitions ────────────────────────────────────────────────
  console.log("\n--- Tool Definitions (for LLM) ---");
  const allTools = registry.allToolDefinitions();
  console.log(`  ${allTools.length} tools available:`);
  for (const tool of allTools) {
    console.log(`    - ${tool.name}: ${tool.description.slice(0, 60)}`);
  }

  // ── 5. Skills ──────────────────────────────────────────────────────────
  console.log("\n--- Skills ---");
  const skillReg = new SkillRegistry();
  skillReg.register(new RepoAnalysisSkill());
  skillReg.register(new CodeEditSkill());

  const skills = skillReg.list();
  console.log(`  ${skills.length} skills registered:`);
  for (const s of skills) {
    console.log(`    - ${s.name} (${s.tags.join(", ")}): ${s.description}`);
  }

  const found = skillReg.findForTask("analyze the repository structure");
  if (found) {
    console.log(`  Best skill for "analyze the repository": ${found.manifest.name}`);
  }

  // ── 6. Provider Router ─────────────────────────────────────────────────
  console.log("\n--- Provider Router ---");
  const router = new ProviderRouter("claude");

  // Register mock provider for demo (no API key needed)
  router.register(
    {
      name: "demo",
      isAvailable: () => true,
      complete: async () => ({
        ok: true as const,
        value: {
          content: "This is a demo response",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          model: "demo-v1",
          finishReason: "stop" as const,
        },
      }),
      healthcheck: async () => true,
      listModels: async () => [{ id: "demo-v1", isFree: true }],
    },
    {
      name: "demo",
      supportsTools: false,
      supportsStreaming: false,
      supportsVision: false,
      maxContextTokens: 4096,
      costTier: "free",
      strengthProfile: { reasoning: 5, coding: 5, creativity: 5, speed: 10, accuracy: 5 },
    },
  );

  const providers = router.listProviders();
  console.log(`  ${providers.length} providers: ${providers.map((p) => `${p.name}(${p.available ? "ok" : "no key"})`).join(", ")}`);

  const selected = router.selectProvider({ taskType: "fast" });
  console.log(`  Best for "fast" task: ${selected?.name || "none"}`);

  console.log("\n=== Demo Complete ===");
}

main().catch(console.error);
