import { describe, it, expect, beforeEach } from "vitest";
import { SafetyEngine } from "@splash/safety";
import { FileMemoryStore, MemoryManager } from "@splash/memory";
import {
  ConnectorRegistry,
  FilesystemConnector,
  TerminalConnector,
} from "@splash/connectors";
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
} from "@splash/skills";
import { ProviderRouter } from "@splash/providers";
import { loadConfig } from "@splash/config";
import type { CompletionResponse, Result } from "@splash/utils";
import { ok } from "@splash/utils";

/**
 * Integration tests that verify all packages work together.
 * These do NOT call real APIs — they use mock providers.
 */

function createMockProvider(name: string, responseContent: string = "mock response") {
  return {
    provider: {
      name,
      isAvailable: () => true,
      healthcheck: async () => true,
      listModels: async () => [{ id: `${name}-v1`, isFree: false }],
      complete: async (): Promise<Result<CompletionResponse>> =>
        ok({
          content: responseContent,
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          model: `${name}-v1`,
          finishReason: "stop" as const,
        }),
    },
    capabilities: {
      name,
      supportsTools: true,
      supportsStreaming: false,
      supportsVision: false,
      maxContextTokens: 4096,
      costTier: "free" as const,
      strengthProfile: {
        reasoning: 5,
        coding: 5,
        creativity: 5,
        speed: 10,
        accuracy: 5,
      },
    },
  };
}

describe("Integration: Full system wiring", () => {
  it("loads config, creates all subsystems, and wires them together", () => {
    // Config
    const configResult = loadConfig({
      providers: { default: "mock" },
      safety: { mode: "standard" },
    });
    expect(configResult.ok).toBe(true);
    if (!configResult.ok) return;

    const config = configResult.value;

    // Provider router
    const router = new ProviderRouter(config.providers.default);
    const mock = createMockProvider("mock");
    router.register(mock.provider, mock.capabilities);
    expect(router.listProviders()).toHaveLength(1);
    expect(router.selectProvider()?.name).toBe("mock");

    // Connectors
    const connectors = new ConnectorRegistry();
    connectors.register(new FilesystemConnector());
    connectors.register(new TerminalConnector());
    expect(connectors.list()).toHaveLength(2);
    expect(connectors.allToolDefinitions().length).toBeGreaterThan(0);

    // Skills
    const skills = new SkillRegistry();
    skills.register(new RepoAnalysisSkill());
    skills.register(new CodeEditSkill());
    skills.register(new TestRunnerSkill());
    skills.register(new TaskSummarizerSkill());
    skills.register(new DebuggerSkill());
    skills.register(new PrCreatorSkill());
    skills.register(new DocsGeneratorSkill());
    skills.register(new MessageDrafterSkill());
    skills.register(new DeployerSkill());
    skills.register(new ApiIntegratorSkill());
    expect(skills.list()).toHaveLength(10);

    // Safety
    const safety = new SafetyEngine(config.safety.mode, config.safety.blockedPatterns);
    expect(safety.getMode()).toBe("standard");

    // Memory
    const memStore = new FileMemoryStore(".splash/test-integration");
    const memory = new MemoryManager(memStore);
    expect(memory).toBeDefined();
  });

  it("connector registry resolves tool actions correctly", () => {
    const registry = new ConnectorRegistry();
    registry.register(new FilesystemConnector());
    registry.register(new TerminalConnector());

    // Find by action name
    const fsMatch = registry.findByAction("fs.read");
    expect(fsMatch).toBeDefined();
    expect(fsMatch!.connector.name).toBe("fs");
    expect(fsMatch!.action).toBe("read");

    const termMatch = registry.findByAction("terminal.run");
    expect(termMatch).toBeDefined();
    expect(termMatch!.connector.name).toBe("terminal");

    // Unknown action
    const unknown = registry.findByAction("nonexistent.action");
    expect(unknown).toBeUndefined();
  });

  it("skill registry matches skills by tag and task description", () => {
    const skills = new SkillRegistry();
    skills.register(new RepoAnalysisSkill());
    skills.register(new CodeEditSkill());
    skills.register(new TestRunnerSkill());
    skills.register(new DebuggerSkill());

    // By tag
    const testSkills = skills.findByTag("test");
    expect(testSkills.length).toBe(1);
    expect(testSkills[0]!.manifest.name).toBe("test-runner");

    // By task description
    const match = skills.findForTask("analyze the repo structure");
    expect(match?.manifest.name).toBe("repo-analysis");

    const debugMatch = skills.findForTask("debug this error in the code");
    expect(debugMatch?.manifest.name).toBe("debugger");
  });

  it("provider router selects by task type", async () => {
    const router = new ProviderRouter("smart");
    const smart = createMockProvider("smart");
    const fast = createMockProvider("fast");

    smart.capabilities.strengthProfile.reasoning = 10;
    smart.capabilities.strengthProfile.speed = 3;
    fast.capabilities.strengthProfile.reasoning = 4;
    fast.capabilities.strengthProfile.speed = 10;

    router.register(smart.provider, smart.capabilities);
    router.register(fast.provider, fast.capabilities);

    // Should pick smart for reasoning
    const reasoner = router.selectProvider({ taskType: "reasoning" });
    expect(reasoner?.name).toBe("smart");

    // Should pick fast for speed
    const speedy = router.selectProvider({ taskType: "fast" });
    expect(speedy?.name).toBe("fast");
  });

  it("safety engine catches SSH key access", () => {
    const safety = new SafetyEngine("standard");

    const sshVerdict = safety.evaluate("cat ~/.ssh/id_rsa");
    expect(sshVerdict.riskLevel).toBe("dangerous");
    expect(sshVerdict.requiresConfirmation).toBe(true);

    const pemVerdict = safety.evaluate("cat server.pem");
    expect(pemVerdict.riskLevel).toBe("dangerous");
  });

  it("memory stores and retrieves entries end to end", async () => {
    const store = new FileMemoryStore(".splash/test-e2e-memory");
    const memory = new MemoryManager(store);

    await memory.remember("project", "language", "TypeScript");
    await memory.remember("decision", "provider", "Use Claude for reasoning");

    const projectMem = await memory.recall("project");
    expect(projectMem.ok).toBe(true);
    if (projectMem.ok) {
      expect(projectMem.value.length).toBeGreaterThan(0);
      expect(projectMem.value.some((e: { value: unknown }) => e.value === "TypeScript")).toBe(true);
    }

    const context = await memory.getRelevantContext("TypeScript");
    expect(context.length).toBeGreaterThan(0);
  });
});
