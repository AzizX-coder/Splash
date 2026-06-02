import type { AlpClawConfig, AlpClawConfigOverrides } from "@alpclaw/config";
import { loadConfig } from "@alpclaw/config";
import { SafetyEngine } from "@alpclaw/safety";
import * as fs from "node:fs";
import * as path from "node:path";
import { globalConfigDir } from "@alpclaw/config";
import { FileMemoryStore, MemoryManager } from "@alpclaw/memory";
import {
  ProviderRouter,
  ClaudeProvider,
  OpenAIProvider,
  GeminiProvider,
  OllamaProvider,
  OpenRouterProvider,
} from "@alpclaw/providers";
import {
  ConnectorRegistry,
  FilesystemConnector,
  TerminalConnector,
  DatabaseConnector,
  HttpConnector,
  BrowserConnector,
  GitConnector,
  GitHubConnector,
  MessagingConnector,
  WebhookConnector,
} from "@alpclaw/connectors";
import {
  SkillRegistry,
  RepoAnalysisSkill,
  CodeEditSkill,
  TestRunnerSkill,
  TaskSummarizerSkill,
  DebuggerSkill,
  PrCreatorSkill,
  DocsGeneratorSkill,
  MessageDrafterSkill,
  DeployerSkill,
  ApiIntegratorSkill,
  WebSearchSkill,
  DatabaseAdminSkill,
  PythonRunnerSkill,
  ShellRunnerSkill,
  CodeReviewerSkill,
  WebScraperSkill,
  DataAnalystSkill,
  SqlBuilderSkill,
  SubagentRunnerSkill,
  GitHelperSkill,
  LinearTriageSkill,
  NotionSyncSkill,
  ConfigEditorSkill,
} from "@alpclaw/skills";
import { createLogger } from "@alpclaw/utils";
import { AgentLoop, type AgentLoopCallbacks } from "./agent-loop.js";

const log = createLogger("alpclaw");

/**
 * AlpClaw is the main entry point / factory for building an agent instance.
 * It wires together all subsystems: providers, connectors, skills, safety, memory.
 */
export class AlpClaw {
  readonly config: AlpClawConfig;
  readonly router: ProviderRouter;
  readonly connectors: ConnectorRegistry;
  readonly skills: SkillRegistry;
  readonly safety: SafetyEngine;
  readonly memory: MemoryManager;

  private constructor(config: AlpClawConfig) {
    this.config = config;

    // ── Providers ──────────────────────────────────────────────────────────
    this.router = new ProviderRouter(config.providers.default);

    const apiKeys = config.providers.apiKeys;

    if (apiKeys["claude"]) {
      this.router.register(
        new ClaudeProvider(apiKeys["claude"]),
        ClaudeProvider.capabilities(),
      );
    }
    if (apiKeys["openai"]) {
      this.router.register(
        new OpenAIProvider(apiKeys["openai"]),
        OpenAIProvider.capabilities(),
      );
    }
    if (apiKeys["gemini"]) {
      this.router.register(
        new GeminiProvider(apiKeys["gemini"]),
        GeminiProvider.capabilities(),
      );
    }
    if (apiKeys["deepseek"]) {
      this.router.register(
        new OpenAIProvider(apiKeys["deepseek"], {
          name: "deepseek",
          baseUrl: "https://api.deepseek.com/v1",
          defaultModel: "deepseek-chat",
        }),
        OpenAIProvider.capabilities("deepseek"),
      );
    }
    if (apiKeys["openrouter"]) {
      this.router.register(
        new OpenRouterProvider(apiKeys["openrouter"], { defaultModel: config.providers.defaultModel }),
        OpenRouterProvider.capabilities(),
      );
    }
    
    // Always register Ollama as it connects locally without keys
    this.router.register(
      new OllamaProvider(),
      OllamaProvider.capabilities(),
    );

    // ── Connectors ─────────────────────────────────────────────────────────
    this.connectors = new ConnectorRegistry();
    this.connectors.register(new FilesystemConnector());
    this.connectors.register(new TerminalConnector());
    this.connectors.register(new DatabaseConnector());
    this.connectors.register(new HttpConnector());
    this.connectors.register(new BrowserConnector());
    this.connectors.register(new GitConnector());
    this.connectors.register(new GitHubConnector(""));
    this.connectors.register(new MessagingConnector());
    this.connectors.register(new WebhookConnector());

    // ── Skills ─────────────────────────────────────────────────────────────
    this.skills = new SkillRegistry();
    this.skills.register(new RepoAnalysisSkill());
    this.skills.register(new CodeEditSkill());
    this.skills.register(new TestRunnerSkill());
    this.skills.register(new TaskSummarizerSkill());
    this.skills.register(new DebuggerSkill());
    this.skills.register(new PrCreatorSkill());
    this.skills.register(new DocsGeneratorSkill());
    this.skills.register(new MessageDrafterSkill());
    this.skills.register(new DeployerSkill());
    this.skills.register(new ApiIntegratorSkill());
    this.skills.register(new WebSearchSkill());
    this.skills.register(new DatabaseAdminSkill());
    this.skills.register(new PythonRunnerSkill());
    this.skills.register(new ShellRunnerSkill());
    this.skills.register(new CodeReviewerSkill());
    this.skills.register(new WebScraperSkill());
    this.skills.register(new DataAnalystSkill());
    this.skills.register(new SqlBuilderSkill());
    this.skills.register(new SubagentRunnerSkill());
    this.skills.register(new GitHelperSkill());
    this.skills.register(new LinearTriageSkill());
    this.skills.register(new NotionSyncSkill());
    this.skills.register(new ConfigEditorSkill());

    // ── Safety ─────────────────────────────────────────────────────────────
    this.safety = new SafetyEngine(config.safety.mode, config.safety.blockedPatterns);

    // ── Memory ─────────────────────────────────────────────────────────────
    const memoryStore = new FileMemoryStore(config.memory.storagePath);
    this.memory = new MemoryManager(memoryStore);

    log.info("AlpClaw initialized", {
      providers: this.router.listProviders().map((p) => p.name),
      connectors: this.connectors.list().map((c) => c.name),
      skills: this.skills.list().map((s) => s.name),
      safetyMode: config.safety.mode,
    });
  }

  /**
   * Create an AlpClaw instance with default configuration.
   */
  static async create(overrides?: AlpClawConfigOverrides): Promise<AlpClaw> {
    const configResult = loadConfig(overrides);
    if (!configResult.ok) {
      throw new Error(`Failed to load config: ${configResult.error.message}`);
    }
    const instance = new AlpClaw(configResult.value);
    
    // Auto-discover dynamic skills in ~/.splash/skills/*/index.js
    const skillsDir = path.join(globalConfigDir(), "skills");
    if (fs.existsSync(skillsDir)) {
      const dirs = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (dir.isDirectory()) {
          const indexJs = path.join(skillsDir, dir.name, "index.js");
          const indexMjs = path.join(skillsDir, dir.name, "index.mjs");
          let target = fs.existsSync(indexMjs) ? indexMjs : (fs.existsSync(indexJs) ? indexJs : null);
          if (target) {
            try {
              // Convert to file:// URL for Windows compatibility with import()
              const fileUrl = `file://${target.replace(/\\/g, "/")}`;
              const mod = await import(fileUrl);
              if (mod.default && typeof mod.default === "object" && mod.default.manifest) {
                instance.skills.register(mod.default);
              } else {
                for (const exp of Object.values(mod)) {
                  if (exp && typeof exp === "object" && (exp as any).manifest) {
                    instance.skills.register(exp as any);
                  }
                }
              }
            } catch (e: any) {
               log.error(`Failed to load dynamic skill from ${dir.name}: ${e.message}`);
            }
          }
        }
      }
    }
    
    return instance;
  }

  /**
   * Create an agent loop ready to execute tasks.
   */
  createAgent(callbacks?: AgentLoopCallbacks): AgentLoop {
    return new AgentLoop(
      this.router,
      this.connectors,
      this.skills,
      this.safety,
      this.memory,
      this.config,
      callbacks,
    );
  }
}
