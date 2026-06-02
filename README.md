<div align="center">

```
   ███████╗██████╗ ██╗      █████╗ ███████╗██╗  ██╗
   ██╔════╝██╔══██╗██║     ██╔══██╗██╔════╝██║  ██║
   ███████╗██████╔╝██║     ███████║███████╗███████║
   ╚════██║██╔═══╝ ██║     ██╔══██║╚════██║██╔══██║
   ███████║██║     ███████╗██║  ██║███████║██║  ██║
   ╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
```

### Splash — Autonomous Agent Platform

*A production-grade, self-improving, multi-provider agent platform that is simple, fast, beautiful, and safe.*

[![node](https://img.shields.io/badge/node-%E2%89%A520-2dd4bf?style=flat-square)]()
[![tests](https://img.shields.io/badge/tests-93%20passing-22c55e?style=flat-square)]()
[![license](https://img.shields.io/badge/license-MIT-0e7490?style=flat-square)]()

</div>

---

## 60-Second Demo

Splash is a **local-first autonomous agent** you call from any directory. One global config file, one command — `splash` — and it builds, edits, debugs, runs shells, reads the web, drives bots, whatever the task needs.

```bash
# 1. Install via npm (works natively on Windows, macOS, and Linux)
npm install -g splash-agent

# 2. Configure (30 seconds)
splash init                 # pick provider, paste key, pick model, pick safety

# 3. Go
splash "summarize this folder"
splash "build a FastAPI todo service" --background
splash tui                  # live dashboard
```

No `pnpm dev`. No per-project `.env`. Just `splash`.

---

## Provider Matrix

| Provider | Access | Models | Free Tier? | Best For |
|---|---|---|---|---|
| **OpenRouter** | API Key | 300+ | Yes | Massive catalog, cheap/free models, fast testing |
| **Claude** | API Key | Opus, Sonnet, Haiku | No | Coding, complex reasoning, large context |
| **OpenAI** | API Key | GPT-4o, o3, o4-mini | No | General purpose, reliable tool calling |
| **Gemini** | API Key | 2.5 Pro, 2.5 Flash | Yes | Huge context windows, fast |
| **DeepSeek** | API Key | R1, V3 | Yes | Strong reasoning, extremely affordable |
| **Ollama** | Local | Llama3, Mistral, Qwen | Yes | Complete privacy, offline use, no API keys |

---

## Command Reference

| Command | What it does |
|---|---|
| **Run** | |
| `splash "do X"` | One-shot task, foreground |
| `splash "do X" --background` | Detached background run; returns an id |
| **Config** | |
| `splash config list/get/set/doctor/preset` | Manage system configuration |
| `splash config set-key <provider> <key>` | Save a provider API key |
| `splash config set-bot <bot> <field> <val>`| Save a bot credential |
| **Providers** | |
| `splash providers list` | Show configured providers + health status |
| `splash providers test <name>` | Ping provider API, report latency |
| **Skills** | |
| `splash skills list` | Manage skills |
| **Memory** | |
| `splash memory list/search/export` | Memory operations |
| **Runs** | |
| `splash runs list/logs/stop/retry/attach` | Run management |
| `splash runs show <id>` | Full JSON record |
| **System** | |
| `splash init` | 5-step setup wizard |
| `splash maintenance [--apply]` | Self-check: config drift, skill failures, provider health |
| `splash self-improve` | Analyze recent runs, write learnings |
| **Advanced** | |
| `splash voice` | Interactive STT/TTS loop |
| `splash swarm <task>` | Spawns parallel sub-agents to synthesize an answer |
| `splash antigravity start` | Starts background polling daemon |

### Platform Bots

`splash telegram` · `splash slack` · `splash whatsapp` · `splash messenger` · `splash discord`

Each reads its credentials from `~/.splash/config.json` (or env). Webhook ports: Slack 3001, WhatsApp 3002, Messenger 3003, Discord 3004. Telegram uses long-poll.

---

## The TUI

```
┌─ Splash · Autonomous Agent Dashboard ─────── ≈ ─┐
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

## Configuration

Config precedence (lowest → highest):

1. Schema defaults
2. `~/.splash/config.json`
3. `.env` in cwd + `SPLASH_*` env vars
4. Explicit `loadConfig()` overrides

**Env var names:** `SPLASH_DEFAULT_PROVIDER`, `SPLASH_DEFAULT_MODEL`, `SPLASH_SAFETY_MODE`, `SPLASH_MEMORY_PATH`, `SPLASH_LOG_LEVEL`.

**Provider keys:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY`, `OLLAMA_BASE_URL`.

---

## License

MIT
