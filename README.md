<div align="center">

```
   ███████╗██████╗ ██╗      █████╗ ███████╗██╗  ██╗
   ██╔════╝██╔══██╗██║     ██╔══██╗██╔════╝██║  ██║
   ███████╗██████╔╝██║     ███████║███████╗███████║
   ╚════██║██╔═══╝ ██║     ██╔══██║╚════██║██╔══██║
   ███████║██║     ███████╗██║  ██║███████║██║  ██║
   ╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
```

### 💧 Splash — Autonomous Agent Platform

*TypeScript monorepo · 10-phase agent loop · multi-provider · Ink TUI · background runs*

[![node](https://img.shields.io/badge/node-%E2%89%A520-2dd4bf?style=flat-square)]()
[![tests](https://img.shields.io/badge/tests-93%20passing-22c55e?style=flat-square)]()
[![license](https://img.shields.io/badge/license-MIT-0e7490?style=flat-square)]()

</div>

---

## What is Splash?

Splash is a **local-first autonomous agent** you call from any directory. One global config file, one command — `splash` — and it builds, edits, debugs, runs shells, reads the web, drives bots, whatever the task needs.

Under the hood: a **10-phase agent loop** (intake → understand → plan → context → tool-select → execute → verify → correct → finalize → persist) over a **multi-provider router** (OpenRouter/Kimi, Claude, GPT, Gemini, DeepSeek, Ollama), backed by a **persistent run store** you can inspect live in an Ink TUI.

It's designed to feel like OpenClaw / NanoClaw — install it, drop a key, go.

---

## Quick Start

```bash
# 1. Install via npm (works natively on Windows, macOS, and Linux)
npm install -g splash-agent

# 2. Configure (30 seconds)
splash init                 # pick provider, paste key, pick model, pick safety

# 3. Go
splash "summarize this folder"
splash "build a FastAPI todo service" --background
splash tui                  # live dashboard
# 3. Advanced Features
splash voice                # interactive STT/TTS loop
splash swarm "task"         # parallel sub-agents
splash antigravity start    # spawn background daemon
```

No `pnpm dev`. No per-project `.env`. Just `splash`.

---

## Features

| | |
|---|---|
| **Global CLI** | One binary. Works from any cwd. `~/.splash/config.json` holds keys + defaults. |
| **Multi-Provider** | OpenRouter (default — unlocks Kimi K2 / DeepSeek / Qwen / Claude / GPT), Anthropic, OpenAI, Gemini, DeepSeek, local Ollama. |
| **10-Phase Loop** | Plan → execute → verify → self-correct. Per-step retry budget. Tool-call trace. |
| **Background Runs** | `splash "..." --background` detaches. Inspect with `splash runs` or attach via TUI. |
| **Ink TUI** | Live dashboard: runs list, task graph, resources, streaming logs, keyboard controls. |
| **Platform Bots** | Telegram, Slack, WhatsApp (Twilio), Messenger (Meta), Discord — shared agent behind all. |
| **Safety Engine** | Pattern-based policy with `strict` / `standard` / `permissive` modes, per-action confirmations. |
| **Persistent Memory** | File-backed memory of successful tool strategies across runs. |
| **18 Built-in Skills** | repo-analysis, code-edit, task-queue, test-runner, debugger, pr-creator, docs-generator, web-scraper, data-analyst, sql-builder, python-runner, shell-runner, and more. |
| **Swarm & Voice** | `splash swarm` spawns parallel research agents. `splash voice` drops you into a Whisper STT / Edge TTS audio chat loop. |
| **Self-Improvement**| `splash self-improve` scans recent logs and permanently alters agent behavior by writing to `~/.splash/learnings.md`. |
| **Antigravity Daemon**| `splash antigravity start` detaches a daemon to poll `~/.splash/queue.json` for autonomous execution of queued tasks. |

---

## Commands

### Core

| Command | What it does |
|---|---|
| `splash` | Interactive chat (defaults to chat when no args) |
| `splash "do X"` | One-shot task, foreground |
| `splash "do X" --background` | Detached run; returns an id |
| `splash init` | 30-second wizard → writes `~/.splash/config.json` |
| `splash tui` | Open the live TUI dashboard |
| `splash voice` | Interactive continuous audio STT/TTS loop |
| `splash swarm <task>` | Spawns 3 parallel sub-agents to synthesize an answer |
| `splash antigravity start` | Starts background polling daemon for `TaskQueueSkill` |
| `splash self-improve` | Analyze recent runs to permanently extract behavior rules |
| `splash help` | Show full help |

### Runs

| Command | What it does |
|---|---|
| `splash runs list [--json]` | Show active/recent runs |
| `splash runs logs <id> [--follow]` | Tail events for a run |
| `splash runs attach <id>` | Open a run in the TUI |
| `splash runs stop <id>` | Cancel a running run |
| `splash runs retry <id> [-b]` | Re-run a finished task |
| `splash runs show <id>` | Full JSON record |

### Config

| Command | What it does |
|---|---|
| `splash config list` | Show effective config (keys redacted) |
| `splash config doctor [--json]` | Verify keys, write perms, provider reachability |
| `splash config preset fast\|balanced\|safe` | Apply a profile |
| `splash config set <key> <val>` | Set `defaultProvider`, `defaultModel`, `safetyMode` |
| `splash config set-key <provider> <key>` | Save a provider API key |
| `splash config set-bot <bot> <field> <val>` | Save a bot credential |

### Platforms

`splash telegram` · `splash slack` · `splash whatsapp` · `splash messenger` · `splash discord`

Each reads its credentials from `~/.splash/config.json` (or env). Webhook ports: Slack 3001, WhatsApp 3002, Messenger 3003, Discord 3004. Telegram uses long-poll.

---

## The TUI

```
┌─ 💧 Splash · Autonomous Agent Dashboard ──── ≈ ─┐
│                                                   │
│ ┌── Runs ───┐ ┌── Task Graph ────────────────┐   │
│ │ ▸ ◌ build │ │ ✓ intake  ✓ plan  ◉ execute  │   │
│ │   ✓ test  │ │ ○ verify  ○ finalize         │   │
│ │   ✗ scan  │ └──────────────────────────────┘   │
│ │           │ ┌── Resources ─────────────────┐   │
│ │           │ │ steps 4 · tools 12 · 8.3s    │   │
│ │           │ └──────────────────────────────┘   │
│ │           │ ┌── Live Logs ─────────────────┐   │
│ │           │ │ 14:22:11 phase → execute     │   │
│ │           │ │ 14:22:12 ⚡ fs.read_file     │   │
│ │           │ │ 14:22:14 ⚡ terminal.run     │   │
│ │           │ └──────────────────────────────┘   │
│ └───────────┘                                     │
│ ↑/↓ select · s stop · r retry · p pause · q quit │
└───────────────────────────────────────────────────┘
```

**Shortcuts:** `↑/↓` select · `s` stop · `r` retry · `p` pause/resume · `l` reload logs · `q` quit

---

## Architecture

```
bin/splash.mjs                   ← global launcher (resolves tsx, preserves cwd)
examples/cli.ts                  ← CLI router: chat | tui | runs | config | platforms
packages/
  utils/         Result<T,E>, logger, theme (banner, spinners, droplet frames)
  config/        schema + loader + ~/.splash store
  safety/        pattern-based policy engine
  memory/        file-backed persistent memory
  providers/     Claude / OpenAI / Gemini / Ollama / OpenRouter router
  connectors/    fs / terminal / database / http / browser / git
  skills/        18 reusable task recipes
  core/
    agent-loop.ts             10-phase orchestrator
    runs/
      events.ts               typed RunEvent union
      run-store.ts            ~/.splash/runs + ndjson logs (schema v1)
      run-manager.ts          lifecycle + background worker
    tui/app.tsx               Ink dashboard
bots/                          telegram / slack / whatsapp / messenger / discord
```

**Run lifecycle:** `queued → running → succeeded | failed | cancelled`

Each transition is written to the persistent store. Events stream via append-only ndjson so both the CLI (`runs logs --follow`) and the TUI subscribe to the same source.

---

## Configuration

Config precedence (lowest → highest):

1. Schema defaults
2. `~/.splash/config.json`
3. `.env` in cwd + `SPLASH_*` / `ALPCLAW_*` env vars
4. Explicit `loadConfig()` overrides

**Env var names:** `SPLASH_DEFAULT_PROVIDER`, `SPLASH_DEFAULT_MODEL`, `SPLASH_SAFETY_MODE`, `SPLASH_MEMORY_PATH`, `SPLASH_LOG_LEVEL`.

**Provider keys:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY`, `OLLAMA_BASE_URL`.

---

## Presets

```bash
splash config preset fast       # permissive safety, Kimi K2, foreground
splash config preset balanced   # standard safety (default)
splash config preset safe       # strict safety, confirms every action
```

---

## Doctor

```bash
splash config doctor
```

Checks:
- ✓ Provider key present
- ✓ Config dir writable
- ✓ Runs dir writable
- ✓ Default provider reachable

Prints `fix:` hints for each failing check. Add `--json` for automation-friendly output.

---

## Background Runs in 3 Commands

```bash
# 1. Start a task in the background
splash "refactor auth module to use JWT" --background
# → run_abc123 started (background)

# 2. Check status
splash runs list
# → run_abc123  running  "refactor auth module..."  12s

# 3. Attach in the TUI
splash tui
# → live dashboard with logs, task graph, controls
```

### Troubleshooting Runs

| Problem | Fix |
|---|---|
| Stuck run (status never changes) | `splash runs stop <id>` then `splash runs retry <id>` |
| Corrupted run file | Delete `~/.splash/runs/<id>.json` and `~/.splash/logs/<id>.ndjson` |
| Non-TTY environment (CI, SSH pipe) | All commands fall back to plain text. Use `--json` for structured output. |
| TUI won't render | Ensure terminal supports 256-color. Set `TERM=xterm-256color`. Falls back to run list. |

---

## Development

```bash
pnpm install                # install all workspace deps
pnpm test                   # vitest — 93 tests across 12 test files
pnpm -r run build           # type-check + build all 8 packages
pnpm dev                    # same as `splash` without the global link
```

### Project Structure

| Package | Purpose |
|---|---|
| `@alpclaw/utils` | Result type, logger, theme (banner, spinners, animations) |
| `@alpclaw/config` | Schema, loader, `~/.splash` global store |
| `@alpclaw/safety` | Pattern-based policy engine |
| `@alpclaw/memory` | File-backed persistent memory |
| `@alpclaw/providers` | Multi-provider router (6 providers) |
| `@alpclaw/connectors` | fs / terminal / database / http / browser / git |
| `@alpclaw/skills` | 18 built-in task recipes |
| `@alpclaw/core` | Agent loop, RunManager, TUI |

---

## Goals & Non-Goals

**Goals:** Production-grade. Local-first. Fast first-run. Observable. Extensible (drop a new skill or connector in one file).

**Non-goals (this phase):**
- Multi-host distributed orchestration
- Cloud-hosted run registry
- Web UI

---

## Legacy Name

Splash is the rebrand of **AlpClaw**. The `alpclaw` binary and `ALPCLAW_*` env vars still work — they delegate to `splash`. Legacy `~/.alpclaw/config.json` is auto-migrated on first read.

---

## License

MIT
