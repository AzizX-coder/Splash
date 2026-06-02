#!/usr/bin/env tsx

/**
 * Splash CLI — Autonomous Agent Platform entrypoint.
 *
 * Usage:
 *   splash                          Open an interactive chat.
 *   splash "do X"                   Run a one-shot task from any directory.
 *   splash "do X" --background      Detach; returns a run id.
 *   splash init                     30-second setup wizard (writes ~/.splash/config.json).
 *   splash tui                      Live run dashboard.
 *   splash runs list|logs|stop|retry|attach
 *   splash config list|doctor|preset|set|set-key
 *   splash telegram|slack|whatsapp|messenger|discord  Start a platform bot.
 *   splash help                     Show this help.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { AlpClaw, RunManager, runWorker } from "@alpclaw/core";
import type { AgentPhase, Task } from "@alpclaw/utils";
import { renderBanner, ripple, startLoader } from "@alpclaw/utils";
import {
  readGlobalConfig,
  writeGlobalConfig,
  setApiKey,
  setBotCredential,
  setGlobalValue,
  applyPreset,
  globalConfigPath,
  globalConfigDir,
  runsDir,
  type GlobalConfigShape,
} from "@alpclaw/config";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal() as any);

// Read version from package.json at the repo root (works in bundled dist too via import.meta)
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

let VERSION = "2.3.1";
try {
  const pkg = _require("../../package.json");
  VERSION = pkg.version || VERSION;
} catch { /* bundled — use hardcoded */ }

const PHASE_LABELS: Record<AgentPhase, string> = {
  intake: "Receiving task",
  understand: "Understanding intent",
  plan: "Architecting plan",
  context_fetch: "Accessing memory",
  tool_select: "Selecting capabilities",
  execute: "Executing",
  verify: "Verifying results",
  correct: "Self-correcting",
  finalize: "Finalizing",
  persist: "Writing to persistent memory",
};

const BOT_SPECS: Record<
  string,
  { file: string; label: string; requiredKeys: string[] }
> = {
  telegram:  { file: "telegram.ts",  label: "Telegram",  requiredKeys: ["TELEGRAM_BOT_TOKEN"] },
  slack:     { file: "slack.ts",     label: "Slack",     requiredKeys: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"] },
  whatsapp:  { file: "whatsapp.ts",  label: "WhatsApp",  requiredKeys: ["TWILIO_AUTH_TOKEN"] },
  messenger: { file: "messenger.ts", label: "Messenger", requiredKeys: ["MESSENGER_PAGE_TOKEN", "MESSENGER_VERIFY_TOKEN"] },
  discord:   { file: "discord.ts",   label: "Discord",   requiredKeys: ["DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN"] },
};

// ──────────────────────────────────────────────────────────────────────────
// Entry routing
// ──────────────────────────────────────────────────────────────────────────

function getLevenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[0]![i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j]![0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j]![i] = Math.min(
        matrix[j]![i - 1]! + 1,
        matrix[j - 1]![i]! + 1,
        matrix[j - 1]![i - 1]! + indicator
      );
    }
  }
  return matrix[b.length]![a.length]!;
}

async function main() {
  const args = process.argv.slice(2);
  let cmd = args[0];

  if (!cmd) {
    printHelp();
    return;
  }

  const KNOWN_COMMANDS = [
    "version", "help", "init", "setup", "config", "chat", "telegram", "slack", 
    "whatsapp", "messenger", "discord", "runs", "tui", "dashboard", "self-improve", 
    "providers", "skills", "memory", "maintenance", "voice", "swarm", "antigravity", 
    "run", "doctor"
  ];

  if (!KNOWN_COMMANDS.includes(cmd)) {
    let bestMatch = cmd;
    let bestDist = Infinity;
    for (const known of KNOWN_COMMANDS) {
      const dist = getLevenshteinDistance(cmd, known);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = known;
      }
    }
    if (bestDist <= 2) {
      console.log(`Did you mean: ${bestMatch}?`);
      cmd = bestMatch;
      args[0] = bestMatch;
    }
  }

  if (cmd === "doctor") {
    await runConfig(["doctor"]);
    return;
  }

  switch (cmd) {
    case "version":
    case "--version":
    case "-v":
      console.log(`splash-agent v${VERSION}`);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    case "init":
    case "setup":
      await runInit();
      return;
    case "config":
      await runConfig(args.slice(1));
      return;
    case "chat":
      console.log('Use splash run "prompt" instead.');
      return;
    case "telegram":
    case "slack":
    case "whatsapp":
    case "messenger":
    case "discord":
      await runBot(cmd);
      return;
    case "runs":
      await runRunsCmd(args.slice(1));
      return;
    case "tui":
    case "dashboard":
      await launchTui();
      return;
    case "self-improve":
      await runSelfImprove();
      return;
    case "providers":
      await runProviders(args.slice(1));
      return;
    case "skills":
      await runSkills(args.slice(1));
      return;
    case "memory":
      await runMemory(args.slice(1));
      return;
    case "maintenance":
      await runMaintenance(args.slice(1));
      return;
    case "voice":
      await runVoiceChat();
      return;
    case "swarm":
      await runSwarm(args.slice(1).join(" "));
      return;
    case "antigravity":
      await runAntigravity(args.slice(1));
      return;
    case "_worker":
      // internal: spawned by background runs to execute a pre-allocated run id
      if (args[1] && args[2]) {
        await runWorker(args[1], args.slice(2).join(" "));
        return;
      }
      console.error("Usage: splash _worker <run-id> <task>");
      process.exit(2);
      break;
    case "run":
      if (args[1] && BOT_SPECS[args[1]]) {
        await runBot(args[1]);
        return;
      }
      // `splash run "task" [--background]` form
      if (args[1]) {
        const rest = args.slice(1);
        const bg = rest.includes("--background") || rest.includes("-b");
        const prompt = rest.filter((a) => a !== "--background" && a !== "-b").join(" ");
        await runFromCli(prompt, { background: bg });
        return;
      }
      break;
  }

  const bg = args.includes("--background") || args.includes("-b");
  const promptText = args.filter((a) => a !== "--background" && a !== "-b").join(" ");
  await runFromCli(promptText, { background: bg });
}

// ──────────────────────────────────────────────────────────────────────────
// Help
// ──────────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(renderBanner({ compact: true }));
  console.log(
    [
      "",
      `  ${pc.cyan("Run      ")} ${pc.dim("|")} splash "prompt", run, exec, ask`,
      `  ${pc.cyan("Config   ")} ${pc.dim("|")} config list/get/set/set-key/set-bot/doctor/preset`,
      `  ${pc.cyan("Providers")} ${pc.dim("|")} providers list, providers test <name>`,
      `  ${pc.cyan("Skills   ")} ${pc.dim("|")} skills list`,
      `  ${pc.cyan("Memory   ")} ${pc.dim("|")} memory list/search/export`,
      `  ${pc.cyan("Runs     ")} ${pc.dim("|")} runs list/logs/stop/retry/attach/show`,
      `  ${pc.cyan("System   ")} ${pc.dim("|")} init, maintenance [--apply], self-improve`,
      `  ${pc.cyan("Advanced ")} ${pc.dim("|")} voice, swarm <task>, antigravity start`,
      "",
      pc.dim(`  Version: ${VERSION}`),
      pc.dim(`  Config:  ${globalConfigPath()}`),
      pc.dim(`  Env:     SPLASH_* vars and .env in cwd are loaded.`),
      "",
    ].join("\n")
  );
}

// ──────────────────────────────────────────────────────────────────────────
// init / config
// ──────────────────────────────────────────────────────────────────────────

async function runInit() {
  console.log(renderBanner({ subtitle: "Setup" }));
  p.intro(pc.bgCyan(pc.black(" SPLASH INIT ")));
  p.log.message("Pick a provider and drop in a key. You can change this any time with `splash config`.");

  const existing = readGlobalConfig();
  const next: GlobalConfigShape = { ...existing };
  next.apiKeys = { ...(existing.apiKeys || {}) };

  const provider = await p.select({
    message: "1. Default provider:",
    options: [
      { value: "openrouter", label: "OpenRouter — recommended, unlocks 300+ models" },
      { value: "claude",     label: "Anthropic Claude — direct API" },
      { value: "openai",     label: "OpenAI — GPT-4o, o3, o4-mini" },
      { value: "gemini",     label: "Google Gemini — 2.5 Pro/Flash" },
      { value: "deepseek",   label: "DeepSeek — R1, V3 (affordable)" },
      { value: "ollama",     label: "Ollama — local models, no key needed" },
    ],
  });
  if (p.isCancel(provider)) return abort();

  next.defaultProvider = provider as string;

  if (provider !== "ollama") {
    const key = await p.password({ message: `2. Paste your ${provider} API key (input hidden):` });
    if (p.isCancel(key)) return abort();
    if (key) next.apiKeys[provider as string] = key as string;
  }

  if (provider === "openrouter") {
    const s = p.spinner();
    s.start("Fetching live OpenRouter models...");
    let liveModels: any[] = [];
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models");
      const data = await res.json() as any;
      liveModels = data.data.sort((a: any, b: any) => a.id.localeCompare(b.id));
    } catch (e) {
      // Fallback
    }
    s.stop("Models loaded.");

    const category = await p.select({
      message: "3. Model Category:",
      options: [
        { value: "free", label: "Free — Top performing free models (DeepSeek, Llama)" },
        { value: "paid", label: "Premium (Paid) — SOTA models (Claude 3.5, GPT-4o, Gemini Pro)" },
        { value: "all", label: "All Live Models" },
      ]
    });
    if (p.isCancel(category)) return abort();

    let options: { value: string; label: string }[] = [];
    if (liveModels.length > 0) {
      const isFree = (m: any) => m.pricing?.prompt === "0" && m.pricing?.completion === "0";
      const filtered = category === "free" ? liveModels.filter(isFree) 
                     : category === "paid" ? liveModels.filter((m: any) => !isFree(m))
                     : liveModels;
      
      options = filtered.slice(0, 50).map((m: any) => ({ 
        value: m.id, 
        label: `${m.name} ${isFree(m) ? pc.green("(Free)") : pc.yellow("(Paid)")} - ${m.context_length}k ctx` 
      }));
    } else {
      // Fallback hardcoded if offline
      options = [
        { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (Premium)" },
        { value: "deepseek/deepseek-r1:free", label: "DeepSeek R1 (Free)" },
      ];
    }

    const model = await p.select({
      message: "4. Default model:",
      options: options,
    });
    if (!p.isCancel(model)) next.defaultModel = model as string;
  }

  const safety = await p.select({
    message: "4. Safety level:",
    options: [
      { value: "standard",   label: "Standard — confirms risky actions (recommended)" },
      { value: "strict",     label: "Strict — confirms every action" },
      { value: "permissive", label: "Permissive — fully autonomous" },
    ],
  });
  if (!p.isCancel(safety)) next.safetyMode = safety as GlobalConfigShape["safetyMode"];

  const theme = await p.select({
    message: "5. CLI Theme:",
    options: [
      { value: "splash",     label: "Splash (Default) — Compact colored banner + minimal output" },
      { value: "hydro",      label: "Hydro — Blue ANSI feel, compact" },
      { value: "edge",       label: "Edge — No color, no banner, just prompt" },
      { value: "silent",     label: "Silent — Pure prompt, silent execution" },
    ],
  });
  if (!p.isCancel(theme)) {
    next.cli = next.cli || {};
    next.cli.style = theme as "splash" | "hydro" | "edge" | "silent";
  }

  writeGlobalConfig(next);
  p.outro(pc.green(`✓ Saved to ${globalConfigPath()}`));
  console.log(pc.dim(`\nTry it: ${pc.cyan("splash \"summarize this folder\"")}`));
}

async function runConfig(args: string[]) {
  const sub = args[0];
  if (!sub || sub === "list" || sub === "show") {
    const cfg = readGlobalConfig();
    const redacted = {
      ...cfg,
      apiKeys: Object.fromEntries(
        Object.entries(cfg.apiKeys || {}).map(([k, v]) => [k, redact(v)]),
      ),
      bots: Object.fromEntries(
        Object.entries(cfg.bots || {}).map(([bot, fields]) => [
          bot,
          Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, redact(v)])),
        ]),
      ),
    };
    console.log(pc.dim(`# ${globalConfigPath()}`));
    console.log(JSON.stringify(redacted, null, 2));
    return;
  }

  if (sub === "path") {
    console.log(globalConfigPath());
    return;
  }

  if (sub === "set") {
    const [key, ...rest] = args.slice(1);
    const val = rest.join(" ");
    if (!key || val === "") {
      console.error("Usage: splash config set <defaultProvider|defaultModel|safetyMode> <value>");
      process.exit(2);
    }
    const allowed = ["defaultProvider", "defaultModel", "safetyMode"] as const;
    if (!(allowed as readonly string[]).includes(key)) {
      console.error(`Unknown key. Allowed: ${allowed.join(", ")}`);
      process.exit(2);
    }
    setGlobalValue(key as (typeof allowed)[number], val as any);
    console.log(pc.green(`✓ ${key} = ${val}`));
    return;
  }

  if (sub === "set-key") {
    const [provider, ...rest] = args.slice(1);
    const val = rest.join(" ");
    if (!provider || !val) {
      console.error("Usage: splash config set-key <provider> <api-key>");
      process.exit(2);
    }
    setApiKey(provider, val);
    console.log(pc.green(`✓ API key saved for ${provider}`));
    return;
  }

  if (sub === "set-bot") {
    const [bot, field, ...rest] = args.slice(1);
    const val = rest.join(" ");
    if (!bot || !field || !val) {
      console.error("Usage: splash config set-bot <bot> <field> <value>");
      process.exit(2);
    }
    setBotCredential(bot, field, val);
    console.log(pc.green(`✓ ${bot}.${field} saved`));
    return;
  }

  if (sub === "doctor") {
    await runDoctor(args.slice(1));
    return;
  }

  if (sub === "preset") {
    const name = args[1];
    if (!name || !["fast", "balanced", "safe"].includes(name)) {
      console.error("Usage: splash config preset <fast|balanced|safe>");
      process.exit(2);
    }
    const cfg = applyPreset(name as "fast" | "balanced" | "safe");
    console.log(pc.green(`✓ preset applied: ${name}`));
    console.log(pc.dim(`  safetyMode=${cfg.safetyMode}  runtime=${cfg.runtime}`));
    return;
  }

  console.error("Unknown config subcommand. Use: list | path | set | set-key | set-bot | doctor | preset");
  process.exit(2);
}

// ──────────────────────────────────────────────────────────────────────────
// config doctor
// ──────────────────────────────────────────────────────────────────────────

async function runDoctor(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const autofix = args.includes("--fix") || args.includes("--autofix");
  const cfg = readGlobalConfig();
  const checks: { name: string; ok: boolean; detail: string; fix?: string; autoFixer?: () => Promise<void> | void }[] = [];

  // 1. provider key present
  const hasAnyKey =
    Object.values(cfg.apiKeys || {}).some(Boolean) ||
    !!process.env.ANTHROPIC_API_KEY ||
    !!process.env.OPENAI_API_KEY ||
    !!process.env.OPENROUTER_API_KEY ||
    !!process.env.GOOGLE_API_KEY ||
    !!process.env.DEEPSEEK_API_KEY ||
    !!process.env.OLLAMA_BASE_URL;
  checks.push({
    name: "provider key",
    ok: hasAnyKey,
    detail: hasAnyKey ? "found" : "none",
    fix: "splash init  — or  splash config set-key openrouter sk-or-...",
    autoFixer: async () => {
      console.log(pc.yellow("\nMissing provider key. Launching setup wizard..."));
      await runInit();
    }
  });

  // 2. write perms
  const dir = globalConfigDir();
  let writable = false;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.accessSync(dir, fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  checks.push({
    name: "config dir writable",
    ok: writable,
    detail: dir,
    fix: `chmod u+w ${dir}`,
    autoFixer: () => {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.chmodSync(dir, 0o700);
      } catch (e) {}
    }
  });

  // 3. runs dir
  const rdir = runsDir();
  let runsOK = false;
  try {
    fs.mkdirSync(rdir, { recursive: true, mode: 0o700 });
    fs.accessSync(rdir, fs.constants.W_OK);
    runsOK = true;
  } catch {
    runsOK = false;
  }
  checks.push({ 
    name: "runs dir writable", 
    ok: runsOK, 
    detail: rdir,
    fix: `chmod u+w ${rdir}`,
    autoFixer: () => {
      try {
        if (!fs.existsSync(rdir)) fs.mkdirSync(rdir, { recursive: true, mode: 0o700 });
        fs.chmodSync(rdir, 0o700);
      } catch (e) {}
    }
  });

  // 4. provider reachability (best effort — skip if no fetch)
  const defaultProvider = cfg.defaultProvider || "openrouter";
  const providerHost: Record<string, string> = {
    openrouter: "https://openrouter.ai",
    claude: "https://api.anthropic.com",
    openai: "https://api.openai.com",
    gemini: "https://generativelanguage.googleapis.com",
    deepseek: "https://api.deepseek.com",
    ollama: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  };
  const host = providerHost[defaultProvider];
  let reachable = false;
  if (host && typeof fetch === "function") {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 3000);
      const res = await fetch(host, { method: "HEAD", signal: ac.signal }).catch(() => null);
      clearTimeout(timer);
      reachable = !!res;
    } catch {
      reachable = false;
    }
  }
  checks.push({
    name: `provider reachable (${defaultProvider})`,
    ok: reachable,
    detail: host || "?",
    fix: "check network / VPN",
  });

  if (json) {
    console.log(JSON.stringify({ checks }, null, 2));
    return;
  }

  console.log(pc.cyan(pc.bold("splash config doctor")));
  console.log();
  for (const c of checks) {
    const icon = c.ok ? pc.green("✓") : pc.red("✗");
    console.log(`  ${icon} ${pc.bold(c.name)}  ${pc.dim(c.detail)}`);
    if (!c.ok && c.fix) console.log(`      ${pc.yellow("fix:")} ${c.fix}`);
  }
  const bad = checks.filter((c) => !c.ok).length;
  console.log();
  console.log(bad === 0 ? pc.green("All checks passed.") : pc.yellow(`${bad} check(s) failed.`));

  if (bad !== 0 && autofix) {
    console.log(pc.cyan("\nRunning autofix for failed checks..."));
    for (const c of checks) {
      if (!c.ok && c.autoFixer) {
        await c.autoFixer();
      }
    }
    console.log(pc.green("\nAutofix complete. Run `splash doctor` again to verify."));
    process.exit(0);
  } else if (bad !== 0 && !autofix) {
    console.log(pc.dim(`\nRun \`${pc.cyan("splash doctor --fix")}\` to automatically resolve issues.`));
  }

  if (bad !== 0) process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────
// runs subcommands
// ──────────────────────────────────────────────────────────────────────────

async function runRunsCmd(args: string[]): Promise<void> {
  const sub = args[0] || "list";
  const json = args.includes("--json");
  const rm = new RunManager();

  if (sub === "list") {
    const list = rm.list();
    if (json) {
      console.log(JSON.stringify(list, null, 2));
      return;
    }
    if (list.length === 0) {
      console.log(pc.dim("no runs yet. Start one with `splash \"do X\" --background`"));
      return;
    }
    console.log(pc.cyan(pc.bold("runs")));
    for (const r of list.slice(0, 30)) {
      const color = statusColor(r.status);
      console.log(
        `  ${color(badgeForStatus(r.status))} ${pc.dim(r.id.slice(-10))}  ${r.task.slice(0, 60)}` +
          pc.dim(`  (${r.mode})`),
      );
    }
    return;
  }

  const id = args[1];

  if (sub === "show" || sub === "get") {
    if (!id) return failUsage("splash runs show <id>");
    const rec = rm.get(id);
    if (!rec) { console.error("not found"); process.exit(1); }
    console.log(JSON.stringify(rec, null, 2));
    return;
  }

  if (sub === "stop" || sub === "cancel") {
    if (!id) return failUsage("splash runs stop <id>");
    const ok = rm.stop(id);
    console.log(ok ? pc.green(`✓ stopped ${id}`) : pc.yellow("already ended or unknown"));
    return;
  }

  if (sub === "retry") {
    if (!id) return failUsage("splash runs retry <id>");
    const bg = args.includes("--background") || args.includes("-b");
    const { id: newId } = await rm.retry(id, { background: bg });
    console.log(pc.green(`✓ retry queued as ${newId}`));
    return;
  }

  if (sub === "logs") {
    if (!id) return failUsage("splash runs logs <id>");
    const follow = args.includes("--follow") || args.includes("-f");
    const events = rm.events(id);
    for (const e of events) console.log(formatEventLine(e, json));
    if (follow) {
      const stop = rm.follow(id, (e) => console.log(formatEventLine(e, json)));
      process.on("SIGINT", () => { stop(); process.exit(0); });
    }
    return;
  }

  if (sub === "attach") {
    if (!id) return failUsage("splash runs attach <id>");
    await launchTui(id);
    return;
  }

  failUsage("splash runs <list|show|stop|retry|logs|attach> [id] [--json|--follow]");
}

function failUsage(msg: string): void {
  console.error(msg);
  process.exit(2);
}

function statusColor(s: string): (t: string) => string {
  switch (s) {
    case "running":   return pc.cyan;
    case "succeeded": return pc.green;
    case "failed":    return pc.red;
    case "cancelled": return pc.gray;
    case "queued":    return pc.yellow;
    default:          return pc.white;
  }
}

function badgeForStatus(s: string): string {
  switch (s) {
    case "running":   return "◌ running  ";
    case "succeeded": return "✓ succeeded";
    case "failed":    return "✗ failed   ";
    case "cancelled": return "⊘ cancelled";
    case "queued":    return "○ queued   ";
    default:          return "· " + s;
  }
}

function formatEventLine(e: any, json: boolean): string {
  if (json) return JSON.stringify(e);
  const t = new Date(e.at).toISOString().slice(11, 19);
  switch (e.type) {
    case "RunCreated":   return pc.gray(`[${t}]`) + ` created ${pc.dim("(" + e.mode + ")")}`;
    case "RunStarted":   return pc.gray(`[${t}]`) + pc.cyan(" started");
    case "PhaseChanged": return pc.gray(`[${t}]`) + pc.cyan(` phase → ${e.phase}`);
    case "ToolCalled":   return pc.gray(`[${t}]`) + pc.magenta(` ⚡ ${e.tool}`);
    case "LogLine":      return pc.gray(`[${t}]`) + ` ${e.text}`;
    case "RunCompleted": return pc.gray(`[${t}]`) + pc.green(` ✓ completed (${e.steps ?? 0} steps)`);
    case "RunFailed":    return pc.gray(`[${t}]`) + pc.red(` ✗ ${e.error}`);
    case "RunCancelled": return pc.gray(`[${t}]`) + pc.yellow(` ⊘ cancelled`);
    default:             return pc.gray(`[${t}]`) + " " + JSON.stringify(e);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// TUI launcher
// ──────────────────────────────────────────────────────────────────────────

async function launchTui(_focusId?: string): Promise<void> {
  if (!process.stdout.isTTY) {
    console.log(pc.dim("TUI requires an interactive terminal. Falling back to run list."));
    await runRunsCmd(["list"]);
    return;
  }
  const ink = await import("ink");
  const React = await import("react");
  const { TuiApp } = await import("@alpclaw/core");
  const a = await buildAgent();
  const manager = new RunManager();
  const { waitUntilExit } = ink.render(
    React.createElement(TuiApp, { manager }),
    { exitOnCtrlC: true },
  );
  await waitUntilExit();
}

// ──────────────────────────────────────────────────────────────────────────
// runFromCli — foreground or background one-shot
// ──────────────────────────────────────────────────────────────────────────

async function checkFastPath(prompt: string): Promise<boolean> {
  const lowerPrompt = prompt.toLowerCase().trim();
  
  const createMatch = lowerPrompt.match(/^(?:(?:run\s+)?(?:create|make)\s+file)\s+(.+)$/);
  if (createMatch) {
    try {
      fs.writeFileSync(path.resolve(process.cwd(), createMatch[1]!), "");
      console.log(`[OK] file created: ${createMatch[1]}`);
    } catch (e: any) {
      console.log(`[ERR] failed to create file: ${e.message}`);
    }
    return true;
  }

  const runMatch = lowerPrompt.match(/^(?:(?:run\s+)?command|execute)\s+(.+)$/);
  if (runMatch) {
    try {
      spawnSync(runMatch[1]!, { shell: true, stdio: "inherit" });
      console.log(`[OK] command executed: ${runMatch[1]}`);
    } catch (e: any) {
      console.log(`[ERR] command failed: ${e.message}`);
    }
    return true;
  }

  const searchMatch = lowerPrompt.match(/^(?:(?:run\s+)?search(?:\s+for)?)\s+(.+)$/);
  if (searchMatch) {
    console.log(`[INFO] Searching for: ${searchMatch[1]}...`);
    const { WebSearchSkill } = await import("@alpclaw/skills");
    const skill = new WebSearchSkill();
    const result = await skill.execute({ query: searchMatch[1] }, {} as any);
    console.log((result as any).output || "[INFO] No results found.");
    return true;
  }

  return false;
}

async function runFromCli(prompt: string, opts: { background: boolean }): Promise<void> {
  if (!prompt.trim()) {
    console.log('Use splash run "prompt" instead.');
    return;
  }
  
  if (await checkFastPath(prompt)) {
    return;
  }

  ensureConfigured();
  if (opts.background) {
    const rm = new RunManager();
    const { id } = await rm.start(prompt, { background: true });
    console.log(pc.green(`✓ started background run ${pc.bold(id)}`));
    console.log(pc.dim(`  follow: splash runs logs ${id} --follow`));
    console.log(pc.dim(`  attach: splash runs attach ${id}`));
    return;
  }
  const alpclaw = await buildAgent();
  await runOneShot(alpclaw, prompt);
}

// ──────────────────────────────────────────────────────────────────────────
// Self-Improvement Loop
// ──────────────────────────────────────────────────────────────────────────

function getOutput(res: any): string {
  if (!res) return "Done";
  if (res.ok) {
    return res.value?.result?.output ? String(res.value.result.output) : "Done";
  }
  return res.error?.message || "Error";
}

async function runSelfImprove() {
  console.log(pc.magenta("\nSPLASH SELF-MODIFICATION ENGINE"));
  console.log(pc.dim("Analyzing recent sessions to extract learnings...\n"));
  
  const { EpisodicMemory } = await import("@alpclaw/memory");
  const episodic = new EpisodicMemory();
  const sessions = episodic.getAllSessions();
  if (sessions.length === 0) {
    console.log(pc.yellow("No sessions found to learn from."));
    return;
  }
  
  const latestSessions = sessions.slice(0, 5);
  let aggregatedLogs = "";
  for (const s of latestSessions) {
    const msgs = await episodic.getLastNMessages(s.sessionId, 100);
    aggregatedLogs += `\n--- SESSION ${s.sessionId} ---\n`;
    for (const msg of msgs) {
       aggregatedLogs += `[${msg.role}] ${msg.content}\n`;
    }
  }
  
  const alpclaw = await buildAgent();
  const prompt = `You are the core intelligence of Splash. Your goal is to analyze your recent conversation logs, identify mistakes you made, and write rules to prevent them in the future.
  
Recent Logs:
${aggregatedLogs.slice(-10000)}

Output ONLY a list of crisp, actionable rules you should adopt. Do not explain them. Be concise.`;

  console.log(pc.cyan("Analyzing..."));
  const result = await alpclaw.createAgent({ onPhaseChange: () => {} }).run(prompt);
  
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { globalConfigDir } = await import("@alpclaw/config");
  const learningsFile = path.join(globalConfigDir(), "learnings.md");
  const learnings = `\n## Learnings (${new Date().toISOString()})\n${getOutput(result)}\n`;
  fs.appendFileSync(learningsFile, learnings);
  
  console.log(pc.green(`✓ Success! New rules added to ${learningsFile}:\n`));
  console.log(getOutput(result));
}

// ──────────────────────────────────────────────────────────────────────────
// Voice
// ──────────────────────────────────────────────────────────────────────────

async function runVoiceChat() {
  console.log(pc.magenta("\nSPLASH VOICE CHAT"));
  console.log(pc.dim("Initializing Whisper STT and Edge TTS..."));
  
  console.log(pc.yellow("Note: Live audio recording requires 'sox' to be installed on your system."));
  
  let record: any;
  try {
    // @ts-ignore
    record = await import("node-record-lpcm16");
  } catch (e) {
    console.error(pc.red("node-record-lpcm16 not installed."));
    return;
  }
  
  let OpenAI;
  try {
    OpenAI = (await import("openai")).default;
  } catch (e) {
    console.error(pc.red("openai not installed."));
    return;
  }
  
  const cfg = readGlobalConfig();
  const apiKey = cfg.apiKeys?.openai || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(pc.red("OPENAI_API_KEY is required for Whisper STT. Set it in splash config."));
    return;
  }
  
  const openai = new OpenAI({ apiKey });
  const alpclaw = await buildAgent();
  
  console.log(pc.green("Ready. Press Ctrl+C to exit."));
  
  console.log(pc.cyan("\n[Voice loop initialized - Waiting for audio input...]"));
  console.log(pc.dim("(This feature is a preview. Make sure sox and ffmpeg are in PATH)"));
}

// ──────────────────────────────────────────────────────────────────────────
// Swarm
// ──────────────────────────────────────────────────────────────────────────

async function runSwarm(task: string) {
  if (!task.trim()) {
    console.error(pc.red("Please provide a task. Example: splash swarm 'Research AI models'"));
    return;
  }
  
  console.log(pc.magenta(`\nSPLASH SWARM: ${task}`));
  console.log(pc.dim("Splitting task into 3 parallel sub-agents...\n"));
  
  const alpclaw = await buildAgent();
  
  const promises = [
    alpclaw.createAgent({ onPhaseChange: () => {} }).run(`Sub-agent 1: Focus on the history and background of: ${task}`),
    alpclaw.createAgent({ onPhaseChange: () => {} }).run(`Sub-agent 2: Focus on the current state-of-the-art regarding: ${task}`),
    alpclaw.createAgent({ onPhaseChange: () => {} }).run(`Sub-agent 3: Focus on the future implications of: ${task}`),
  ];
  
  console.log(pc.cyan("Waiting for sub-agents to complete..."));
  const results = await Promise.all(promises);
  
  console.log(pc.green("✓ Sub-agents finished. Aggregating results...\n"));
  
  const leaderPrompt = `You are the Swarm Leader. Aggregate these 3 reports into a final cohesive response for the user's task: "${task}".
  
Report 1:
${getOutput(results[0])}

Report 2:
${getOutput(results[1])}

Report 3:
${getOutput(results[2])}
`;

  const finalRes = await alpclaw.createAgent().run(leaderPrompt);
  console.log(pc.bold("\nLeader Conclusion:\n"));
  console.log(getOutput(finalRes));
}

// ──────────────────────────────────────────────────────────────────────────
// Antigravity Daemon
// ──────────────────────────────────────────────────────────────────────────

async function runAntigravity(args: string[]) {
  if (args[0] !== "start") {
    console.error(pc.red("Usage: splash antigravity start"));
    return;
  }
  
  console.log(pc.magenta("\nSTARTING ANTIGRAVITY DAEMON"));
  
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  
  const daemonScript = `
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// Hardcoded path resolution logic since we are running standalone
const home = process.env.HOME || process.env.USERPROFILE || "";
const globalConfigDir = path.resolve(home, ".splash");
const queueFile = path.join(globalConfigDir, "queue.json");

console.log("Antigravity Daemon running. Polling queue.json...");

setInterval(() => {
  if (fs.existsSync(queueFile)) {
    try {
      const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));
      if (queue.length > 0) {
        const task = queue.shift();
        fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2));
        console.log("Executing task: " + task);
        execSync("splash run \\"" + task + "\\"", { stdio: "inherit" });
      }
    } catch (e) {
      console.error("Daemon error:", e);
    }
  }
}, 5000);
`;
  
  const fs = await import("node:fs");
  const { globalConfigDir } = await import("@alpclaw/config");
  const daemonPath = path.join(globalConfigDir(), "daemon.mjs");
  fs.writeFileSync(daemonPath, daemonScript);
  
  // Spawn detached process
  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore"
  });
  
  child.unref();
  
  console.log(pc.green(`✓ Antigravity daemon detached (PID: ${child.pid}).`));
  console.log(pc.dim(`  It will continuously poll ~/.splash/queue.json for background tasks.`));
  console.log(pc.dim(`  Use 'splash run "..."' with TaskQueueSkill to enqueue tasks.`));
}

// ──────────────────────────────────────────────────────────────────────────
// Providers
// ──────────────────────────────────────────────────────────────────────────

async function runProviders(args: string[]): Promise<void> {
  const sub = args[0] || "list";

  if (sub === "list") {
    const alpclaw = await buildAgent();
    const providers = alpclaw.router.listProviders();
    console.log(`  ${pc.dim("Name".padEnd(14))} ${pc.dim("Status".padEnd(10))} ${pc.dim("Models")}`);

    for (const prov of providers) {
      let status = "OK";
      let modelCount = "-";
      try {
        const models = await prov.provider.listModels();
        modelCount = String(models.length);
        if (!prov.provider.isAvailable()) status = "ERR no key";
      } catch {
        status = "ERR";
      }
      console.log(`  ${prov.name.padEnd(14)} ${status.padEnd(10)} ${modelCount}`);
    }
    console.log();
    return;
  }

  if (sub === "test") {
    const name = args[1];
    if (!name) {
      console.error(pc.red("Usage: splash providers test <name>"));
      return;
    }
    const alpclaw = await buildAgent();
    const match = alpclaw.router.listProviders().find((p) => p.name === name);
    if (!match) {
      console.error(pc.red(`Provider "${name}" not found. Run: splash providers list`));
      return;
    }
    console.log(pc.dim(`Pinging ${name}...`));
    const start = Date.now();
    try {
      const healthy = await match.provider.healthcheck();
      const elapsed = Date.now() - start;
      if (healthy) {
        console.log(pc.green(`  ${name}: healthy (${elapsed}ms)`));
      } else {
        console.log(pc.yellow(`  ${name}: unhealthy (${elapsed}ms)`));
      }
    } catch (e: unknown) {
      const elapsed = Date.now() - start;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(pc.red(`  ${name}: error (${elapsed}ms) — ${msg}`));
    }
    return;
  }

  console.error(pc.red(`Unknown subcommand: providers ${sub}`));
  console.log(pc.dim("  Available: list, test <name>"));
}

// ──────────────────────────────────────────────────────────────────────────
// Skills
// ──────────────────────────────────────────────────────────────────────────

async function runSkills(args: string[]): Promise<void> {
  const sub = args[0] || "list";

  if (sub === "list") {
    const alpclaw = await buildAgent();
    const skills = alpclaw.skills.list();
    console.log(pc.bold(`\n  Registered Skills (${skills.length})\n`));
    for (const skill of skills) {
      const tags = skill.tags?.join(", ") || "";
      console.log(
        `  ${pc.cyan(skill.name.padEnd(20))} ${pc.dim(tags)}`,
      );
    }
    console.log();
    return;
  }

  console.error(pc.red(`Unknown subcommand: skills ${sub}`));
  console.log(pc.dim("  Available: list"));
}

// ──────────────────────────────────────────────────────────────────────────
// Memory
// ──────────────────────────────────────────────────────────────────────────

async function runMemory(args: string[]): Promise<void> {
  const sub = args[0] || "list";
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const memDir = path.resolve(home, ".splash", "memory");
  const sessionsDir = path.join(memDir, "sessions");

  if (sub === "list") {
    if (!fs.existsSync(sessionsDir)) {
      console.log(pc.dim("No sessions recorded yet."));
      return;
    }
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    console.log(pc.bold(`\n  Memory Sessions (${files.length})\n`));
    for (const file of files.slice(-20)) {
      const stat = fs.statSync(path.join(sessionsDir, file));
      const size = (stat.size / 1024).toFixed(1);
      console.log(`  ${pc.cyan(file.padEnd(40))} ${pc.dim(size + " KB")}`);
    }
    console.log();
    return;
  }

  if (sub === "search") {
    const query = args.slice(1).join(" ");
    if (!query) {
      console.error(pc.red("Usage: splash memory search <query>"));
      return;
    }
    if (!fs.existsSync(sessionsDir)) {
      console.log(pc.dim("No sessions to search."));
      return;
    }
    console.log(pc.dim(`Searching sessions for "${query}"...\n`));
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    let matches = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(sessionsDir, file), "utf-8");
      const lines = content.split("\n").filter((l) => l.toLowerCase().includes(query.toLowerCase()));
      if (lines.length > 0) {
        matches += lines.length;
        console.log(pc.cyan(`  ${file}`) + pc.dim(` (${lines.length} matches)`));
        for (const line of lines.slice(0, 3)) {
          try {
            const parsed = JSON.parse(line);
            console.log(pc.dim(`    ${(parsed.content || parsed.text || "").slice(0, 100)}`));
          } catch {
            console.log(pc.dim(`    ${line.slice(0, 100)}`));
          }
        }
      }
    }
    if (matches === 0) console.log(pc.dim("  No matches found."));
    console.log();
    return;
  }

  if (sub === "export") {
    if (!fs.existsSync(sessionsDir)) {
      console.log(pc.dim("No sessions to export."));
      return;
    }
    const outFile = args[1] || "splash-memory-export.json";
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const allEntries: unknown[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(sessionsDir, file), "utf-8");
      for (const line of content.split("\n").filter(Boolean)) {
        try { allEntries.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    }
    fs.writeFileSync(outFile, JSON.stringify(allEntries, null, 2));
    console.log(pc.green(`Exported ${allEntries.length} entries to ${outFile}`));
    return;
  }

  console.error(pc.red(`Unknown subcommand: memory ${sub}`));
  console.log(pc.dim("  Available: list, search <query>, export [file]"));
}

// ──────────────────────────────────────────────────────────────────────────
// Maintenance
// ──────────────────────────────────────────────────────────────────────────

async function runMaintenance(args: string[]): Promise<void> {
  const apply = args.includes("--apply");
  const json = args.includes("--json");

  const home = process.env.HOME || process.env.USERPROFILE || "";
  const splashDir = path.resolve(home, ".splash");
  const memDir = path.join(splashDir, "memory");
  const logsDir = path.join(splashDir, "logs");
  const auditFile = path.join(logsDir, "audit.jsonl");

  interface Check {
    name: string;
    status: "ok" | "warn" | "fail";
    detail: string;
    fix?: () => void;
  }

  const checks: Check[] = [];

  // 1. Config check
  try {
    const cfg = readGlobalConfig();
    const hasKey = Object.values(cfg.apiKeys || {}).some(Boolean);
    if (hasKey) {
      checks.push({ name: "API keys", status: "ok", detail: `${Object.keys(cfg.apiKeys || {}).length} provider(s) configured` });
    } else {
      checks.push({ name: "API keys", status: "warn", detail: "No API keys set. Run: splash init" });
    }
    if (cfg.defaultProvider) {
      checks.push({ name: "Default provider", status: "ok", detail: cfg.defaultProvider });
    } else {
      checks.push({ name: "Default provider", status: "warn", detail: "Not set. Run: splash init" });
    }
  } catch {
    checks.push({ name: "Config", status: "fail", detail: "Failed to read config. Run: splash init" });
  }

  // 2. Provider health
  try {
    const alpclaw = await AlpClaw.create();
    const providers = alpclaw.router.listProviders();
    for (const prov of providers) {
      if (!prov.provider.isAvailable()) {
        checks.push({ name: `Provider: ${prov.name}`, status: "warn", detail: "not configured (no API key)" });
        continue;
      }
      try {
        const start = Date.now();
        const healthy = await prov.provider.healthcheck();
        const elapsed = Date.now() - start;
        checks.push({
          name: `Provider: ${prov.name}`,
          status: healthy ? "ok" : "warn",
          detail: healthy ? `healthy (${elapsed}ms)` : `unhealthy (${elapsed}ms)`,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        checks.push({ name: `Provider: ${prov.name}`, status: "fail", detail: msg.slice(0, 80) });
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({ name: "Provider init", status: "fail", detail: msg.slice(0, 80) });
  }

  // 3. Memory disk usage
  if (fs.existsSync(memDir)) {
    let totalBytes = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else totalBytes += fs.statSync(p).size;
      }
    };
    walk(memDir);
    const mb = (totalBytes / 1024 / 1024).toFixed(1);
    if (totalBytes > 500 * 1024 * 1024) {
      checks.push({
        name: "Memory disk",
        status: "warn",
        detail: `${mb} MB (exceeds 500 MB limit)`,
        fix: () => {
          const sessionsDir = path.join(memDir, "sessions");
          if (fs.existsSync(sessionsDir)) {
            const files = fs.readdirSync(sessionsDir).sort();
            const toRemove = Math.ceil(files.length * 0.2);
            for (const f of files.slice(0, toRemove)) {
              fs.unlinkSync(path.join(sessionsDir, f));
            }
            console.log(pc.dim(`  Pruned ${toRemove} oldest session files.`));
          }
        },
      });
    } else {
      checks.push({ name: "Memory disk", status: "ok", detail: `${mb} MB` });
    }
  } else {
    checks.push({ name: "Memory disk", status: "ok", detail: "No memory directory yet" });
  }

  // 4. Prompts check
  const promptsDir = path.resolve(splashDir, "..", "..", "prompts"); // repo root fallback
  const localPrompts = path.resolve(process.cwd(), "prompts");
  const hasPrompts = fs.existsSync(localPrompts) && fs.readdirSync(localPrompts).some((f) => f.endsWith(".md"));
  checks.push({
    name: "Prompt library",
    status: hasPrompts ? "ok" : "warn",
    detail: hasPrompts ? `Found in ${localPrompts}` : "No prompts/ directory in cwd",
  });

  // 5. Config file exists
  const configFile = globalConfigPath();
  checks.push({
    name: "Config file",
    status: fs.existsSync(configFile) ? "ok" : "warn",
    detail: fs.existsSync(configFile) ? configFile : "Missing. Run: splash init",
  });

  // Output
  if (json) {
    console.log(JSON.stringify({ checks, applied: apply }, null, 2));
    return;
  }

  console.log(pc.bold("\n  Splash Maintenance Report\n"));
  for (const c of checks) {
    const icon = c.status === "ok" ? pc.green("ok") : c.status === "warn" ? pc.yellow("!!") : pc.red("FAIL");
    console.log(`  [${icon}] ${pc.bold(c.name.padEnd(22))} ${pc.dim(c.detail)}`);
  }

  const fixable = checks.filter((c) => c.fix);
  if (fixable.length > 0 && apply) {
    console.log(pc.bold("\n  Applying fixes...\n"));
    // Write audit log
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    for (const c of fixable) {
      const entry = { ts: new Date().toISOString(), action: "maintenance-fix", check: c.name, detail: c.detail };
      fs.appendFileSync(auditFile, JSON.stringify(entry) + "\n");
      c.fix!();
      console.log(pc.green(`  Fixed: ${c.name}`));
    }
  } else if (fixable.length > 0 && !apply) {
    console.log(pc.dim(`\n  ${fixable.length} fixable issue(s). Run: splash maintenance --apply`));
  }

  const bad = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  console.log();
  if (bad === 0 && warned === 0) {
    console.log(pc.green("  All checks passed."));
  } else {
    console.log(pc.dim(`  ${checks.length} checks: ${checks.length - bad - warned} ok, ${warned} warnings, ${bad} failures`));
  }
  console.log();
}

// ──────────────────────────────────────────────────────────────────────────
// Bots
// ──────────────────────────────────────────────────────────────────────────

async function runBot(name: string) {
  const spec = BOT_SPECS[name];
  if (!spec) {
    console.error(`Unknown platform: ${name}`);
    process.exit(2);
  }

  // Hydrate env from global config (bots.<name>.*) so bot files can stay env-var-based.
  const cfg = readGlobalConfig();
  const botCreds = cfg.bots?.[name] || {};
  const env = { ...process.env };
  for (const k of spec.requiredKeys) {
    if (!env[k] && botCreds[k]) env[k] = botCreds[k];
  }
  // Also hydrate provider keys for the agent itself.
  for (const [prov, key] of Object.entries(cfg.apiKeys || {})) {
    const envKey = providerEnvKey(prov);
    if (envKey && !env[envKey]) env[envKey] = key;
  }

  // Check required keys.
  const missing = spec.requiredKeys.filter((k) => !env[k]);
  if (missing.length) {
    console.error(pc.red(`Missing ${spec.label} credentials: ${missing.join(", ")}`));
    console.error(pc.dim("Run `splash config set-bot " + name + " <FIELD> <value>` for each."));
    process.exit(2);
  }

  const alpclawHome = process.env.SPLASH_HOME || process.env.ALPCLAW_HOME || process.cwd();
  
  // Prefer the bundled JS version in dist/ if available (for production)
  const distBotPath = path.resolve(alpclawHome, "dist", "bots", spec.file.replace(".ts", ".js"));
  const srcBotPath = path.resolve(alpclawHome, "bots", spec.file);
  
  let executeCmd = "";
  let executeArgs: string[] = [];

  if (fs.existsSync(distBotPath)) {
    executeCmd = process.execPath; // node
    executeArgs = [distBotPath];
  } else if (fs.existsSync(srcBotPath)) {
    const tsxName = process.platform === "win32" ? "tsx.cmd" : "tsx";
    const tsxCandidates = [
      path.resolve(alpclawHome, "node_modules", ".bin", tsxName),
      path.resolve(alpclawHome, "..", "..", "node_modules", ".bin", tsxName),
      tsxName,
    ];
    executeCmd = tsxCandidates.find((p) => fs.existsSync(p)) || tsxName;
    executeArgs = [srcBotPath];
  } else {
    console.error(pc.red(`Bot entrypoint not found for ${name}`));
    process.exit(1);
  }

  console.log(renderBanner({ subtitle: `${spec.label} bridge` }));
  console.log(pc.dim(`Starting ${name}...`));

  const result = spawnSync(executeCmd, executeArgs, { stdio: "inherit", env });
  process.exit(result.status ?? 0);
}

function providerEnvKey(provider: string): string | null {
  switch (provider) {
    case "claude":     return "ANTHROPIC_API_KEY";
    case "openai":     return "OPENAI_API_KEY";
    case "gemini":     return "GOOGLE_API_KEY";
    case "deepseek":   return "DEEPSEEK_API_KEY";
    case "openrouter": return "OPENROUTER_API_KEY";
    default:           return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// One-shot + chat
// ──────────────────────────────────────────────────────────────────────────

function loadPersona(): string | undefined {
  const localChar = path.resolve(process.cwd(), "character.md");
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const splashChar = path.resolve(home, ".splash", "character.md");
  const globalChar = path.resolve(home, ".alpclaw", "character.md");
  if (fs.existsSync(localChar)) return fs.readFileSync(localChar, "utf-8");
  if (fs.existsSync(splashChar)) return fs.readFileSync(splashChar, "utf-8");
  if (fs.existsSync(globalChar)) return fs.readFileSync(globalChar, "utf-8");
  return undefined;
}

function ensureConfigured(): void {
  const cfg = readGlobalConfig();
  const hasKey = Object.values(cfg.apiKeys || {}).some(Boolean) ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OLLAMA_BASE_URL;

  if (!hasKey) {
    console.log(renderBanner({ subtitle: "First run" }));
    console.log(pc.yellow("No API key configured yet. Run:"));
    console.log(`  ${pc.cyan("splash init")}`);
    console.log(pc.dim("Or, without the wizard:"));
    console.log(`  ${pc.cyan("splash config set-key openrouter sk-or-...")}`);
    process.exit(1);
  }
}

async function buildAgent(): Promise<AlpClaw> {
  ensureConfigured();
  try {
    return await AlpClaw.create();
  } catch (err) {
    console.error(pc.red(`Failed to initialize Splash: ${String(err)}`));
    process.exit(1);
  }
}

function printStatusLine(a: AlpClaw): void {
  const pConf = a.config.providers;
  const s = a.config.safety;
  const cfg = readGlobalConfig();
  const runtime = cfg.runtime || "foreground";
  const style = cfg.cli?.style || "splash";

  if (style === "silent") {
    // No banner/status line for minimal
    return;
  }

  console.log(
    "  " +
      pc.bold("splash") +
      pc.dim("  provider=") + pc.white(pConf.default) +
      pc.dim("  model=") + pc.white(pConf.defaultModel) +
      pc.dim("  safety=") + pc.white(s.mode) +
      pc.dim("  runtime=") + pc.white(runtime),
  );
}

async function runOneShot(alpclaw: AlpClaw, description: string, persona?: string): Promise<void> {
  const cfg = readGlobalConfig();
  const style = cfg.cli?.style || "splash";
  
  let s = p.spinner();
  let currentPhase = "";
  let lastTool = "";

  const updateSpinner = (message: string) => {
    if (style === "silent") return; // Silent execution
    

    // Default Splash style
    if (currentPhase && currentPhase !== message) {
      s.stop(pc.green(`✓ ${currentPhase}`));
      s = p.spinner();
    }
    currentPhase = message;
    s.start(pc.blue(message));
  };

    p.log.step(pc.bold(description));

  const agent = alpclaw.createAgent({
    systemPersona: persona,
    onPhaseChange: (phase: AgentPhase, _task: Task) => {
      updateSpinner(PHASE_LABELS[phase] || phase);
    },
    onToolCall: (toolName: string, args: Record<string, unknown>) => {
      if (style === "silent") return;
      
      
      // Default Splash style
      s.message(`${pc.magenta("⚡")} ${pc.bold(toolName)} ${pc.dim(JSON.stringify(args).slice(0, 60))}`);
    },
    onStepComplete: () => {},
    onError: (error: string, phase: AgentPhase) => {
      if (style === "splash") {
        p.log.error(pc.red(`[${phase}] ${error}`));
      } else {
        console.error(`${pc.red(`[error:${phase}]`)} ${error}`);
      }
    },
    onConfirmationRequired: async (action: string, risk: string): Promise<boolean> => {
      if (style === "splash") s.stop("Safety engine paused execution.");
      const allowed = await p.confirm({
        message: `${pc.bgYellow(pc.black(" WARN "))} ${pc.bold(action)} (risk: ${pc.red(risk)}). Allow?`,
      });
      if (style === "splash") {
        s = p.spinner();
        s.start("Resuming...");
      }
      return !!allowed && !p.isCancel(allowed);
    },
  });

  const result = await agent.run(description);

  if (currentPhase) {
    s.stop(pc.green(`✓ ${currentPhase}`));
  }

  if (result.ok) {
    const task = result.value;
    const body = task.result?.summary ? marked.parse(task.result.summary) : "No output.";
    
    if (style !== "silent") {
      p.note(
        [
          `${pc.cyan("status:")} ${task.status === "completed" ? pc.green(task.status) : pc.yellow(task.status)}`,
          `${pc.cyan("steps:")}  ${task.steps.length}`,
          `\n${body}`,
        ].join("\n"),
        "Result",
      );
    } else {
      console.log(`\n${body}`);
    }
  } else {
    if (style !== "silent") {
      p.log.error(pc.bgRed(pc.white(" ERROR ")) + " " + result.error.message);
    } else {
      console.error(`${pc.red("x")} ${result.error.message}`);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function redact(v: string): string {
  if (!v) return "";
  if (v.length <= 8) return "****";
  return v.slice(0, 4) + "…" + v.slice(-4);
}

function abort(): never {
  p.cancel("Setup cancelled.");
  process.exit(0);
}

main().catch((err) => {
  console.error(pc.bgRed(pc.white(" FATAL ")) + `\n\n${err?.stack || err}`);
  process.exit(1);
});
