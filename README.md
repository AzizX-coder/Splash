<div align="center">

```
   ███████╗██████╗ ██╗      █████╗ ███████╗██╗  ██╗
   ██╔════╝██╔══██╗██║     ██╔══██╗██╔════╝██║  ██║
   ███████╗██████╔╝██║     ███████║███████╗███████║
   ╚════██║██╔═══╝ ██║     ██╔══██║╚════██║██╔══██║
   ███████║██║     ███████╗██║  ██║███████║██║  ██║
   ╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
```

# Splash: Agent Engine for Agencies

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)]()
[![License](https://img.shields.io/badge/License-MIT-0e7490?style=flat-square)]()
[![Build](https://img.shields.io/badge/Build-Passing-22c55e?style=flat-square)]()
[![Tests](https://img.shields.io/badge/Tests-125%20Passing-22c55e?style=flat-square)]()
[![Version](https://img.shields.io/badge/Version-3.1.1-blue?style=flat-square)]()

*A production-ready, self-improving, multi-provider autonomous agent engine built for reliability, precision, and agency workflows.*

</div>

---

## ⚡ What is Splash?

Splash Core (v3.1.1) is an **autonomous execution engine**—not a chatbot. It is a strictly contract-based, multi-modal AI system that executes real-world tasks with precision, automatically audits its own work, and evolves its memory layers from every operation. Built for developers and agencies looking for deterministic outcomes over conversational fluff.

## 🌟 Why Splash?

- **Contract-First Execution:** Every multi-step task generates a typed JSON execution contract outlining steps, token budgets, and verification criteria before execution begins.
- **Advanced Memory Architecture:** A robust 4-layer memory system (Working, Episodic, Semantic, Procedural) with a dedicated **Trash Memory** quarantine to prevent adversarial noise from polluting core skills.
- **Safety as a First-Class Concern:** Four configurable safety tiers (permissive, standard, strict, paranoid) physically block destructive actions and leakages, validated by independent safety filters.
- **Instant Fast-Paths:** Deterministic sub-100ms bypasses for common operations, sidestepping the LLM loop entirely to save tokens and time.
- **Multi-Provider Arbitration:** Native routing to OpenRouter, Claude, OpenAI, Gemini, DeepSeek, and local Ollama deployments with automatic rate-limit fallbacks.

## 📦 Install

You can install Splash with a single curl command on macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/splash-agent/splash/main/scripts/install.sh | bash
```

For Windows PowerShell and manual installation methods, see [docs/INSTALL.md](docs/INSTALL.md).

**Initialize Configuration:**
```bash
splash init
```

## 🚀 Quickstart

Splash natively supports execution directly from the command line:

### 1. Instant Fast-Path Tasks
```bash
# Bypass the LLM entirely for deterministic system commands
splash "list files in src/"
```

### 2. Autonomous Agent Loops
```bash
# Engages the full contract builder and execution loop
splash "debug the memory leak in packages/core/src/agent-loop.ts"
```

### 3. Background Detached Runs
```bash
# Detaches execution to the daemon so you can track it later
splash "build a FastAPI todo service" --background
```

## 🛠️ Features

### Core Engine
- **Contract Builder:** Generates deterministic execution plans (`packages/core/src/contract-builder.ts`).
- **State Machine:** Strongly-typed execution lifecycle (`packages/core/src/state-machine.ts`).
- **Reflector:** Evaluates executed steps and extracts permanent learnings, scoring quality via an automated heuristic.

### Memory Systems
- **Semantic Memory:** Long-term storage of validated facts.
- **Episodic Memory:** Context tracking across sessions.
- **Trash Memory:** Quarantines failed, noisy, or adversarial prompts to prevent skill pollution.

### Skills
- 36 Built-in foundational skills loaded dynamically via registry.
- Heavy dependencies dynamically imported to preserve <100ms startup times.

### Connectors
- **Real:** Filesystem, Webhook, Terminal, Browser, HTTP.
- **Configuration Available / Coming Soon:** Gmail, SMS, Telegram, Discord, Slack, WhatsApp. *(Note: these gateway connectors currently validate config but await full real-world REST API mappings).*

### CLI / TUI
- Fully-featured non-interactive mode.
- Interactive `ink`-based Terminal User Interface (`splash tui`) for real-time state monitoring.

### Providers
- Native API connectors for Anthropic, OpenAI, Google Gemini, Groq, Mistral, Together, DeepSeek, and Ollama.

## 🗺️ Roadmap

- **Done:** V3 Engine (Contract Execution, Memory Layers, Safety Engine, Trash Memory).
- **In Progress:** Transitioning simulated gateway connectors (Discord, Telegram, Slack) to real REST/WebSocket API implementations.
- **Planned:** Full MCP (Model Context Protocol) plugin integration for cross-agent compatibility.

## 📚 Documentation
- **[docs/COMMANDS.md](docs/COMMANDS.md)** — Complete CLI reference manual.
- **[docs/INSTALL.md](docs/INSTALL.md)** — Detailed OS-specific installation instructions.
- **[docs/VERIFICATION.md](docs/VERIFICATION.md)** — Test suite and operational proof records.

## 📜 License
MIT License. See [LICENSE](LICENSE) for details.

---
*Built with precision for the autonomous future.*
