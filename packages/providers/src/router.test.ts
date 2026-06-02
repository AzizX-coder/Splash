import { describe, it, expect } from "vitest";
import { ProviderRouter } from "./router.js";
import type { ModelProvider, ProviderCapabilities } from "./provider.js";
import type { CompletionRequest, CompletionResponse, Result } from "@alpclaw/utils";
import { ok } from "@alpclaw/utils";

function mockProvider(name: string, available: boolean = true): ModelProvider {
  return {
    name,
    isAvailable: () => available,
    healthcheck: async () => available,
    listModels: async () => [{ id: `${name}-v1`, isFree: false }],
    complete: async (): Promise<Result<CompletionResponse>> =>
      ok({
        content: `Response from ${name}`,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: `${name}-v1`,
        finishReason: "stop",
      }),
  };
}

function mockCapabilities(
  name: string,
  overrides: Partial<ProviderCapabilities> = {},
): ProviderCapabilities {
  return {
    name,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
    maxContextTokens: 100000,
    costTier: "medium",
    strengthProfile: {
      reasoning: 7,
      coding: 7,
      creativity: 7,
      speed: 7,
      accuracy: 7,
    },
    ...overrides,
  };
}

describe("ProviderRouter", () => {
  it("registers and lists providers", () => {
    const router = new ProviderRouter();
    router.register(mockProvider("alpha"), mockCapabilities("alpha"));
    router.register(mockProvider("beta"), mockCapabilities("beta"));

    const list = router.listProviders();
    expect(list.length).toBe(2);
    expect(list.map((p) => p.name)).toContain("alpha");
  });

  it("selects the default provider when no criteria", () => {
    const router = new ProviderRouter("alpha");
    router.register(mockProvider("alpha"), mockCapabilities("alpha"));
    router.register(mockProvider("beta"), mockCapabilities("beta"));

    const selected = router.selectProvider();
    expect(selected?.name).toBe("alpha");
  });

  it("selects preferred provider when specified", () => {
    const router = new ProviderRouter("alpha");
    router.register(mockProvider("alpha"), mockCapabilities("alpha"));
    router.register(mockProvider("beta"), mockCapabilities("beta"));

    const selected = router.selectProvider({ preferProvider: "beta" });
    expect(selected?.name).toBe("beta");
  });

  it("falls back when preferred provider unavailable", () => {
    const router = new ProviderRouter("alpha");
    router.register(mockProvider("alpha"), mockCapabilities("alpha"));
    router.register(mockProvider("beta", false), mockCapabilities("beta"));

    const selected = router.selectProvider({ preferProvider: "beta" });
    expect(selected?.name).toBe("alpha");
  });

  it("selects best provider for task type", () => {
    const router = new ProviderRouter();
    router.register(
      mockProvider("slow-smart"),
      mockCapabilities("slow-smart", {
        strengthProfile: { reasoning: 10, coding: 10, creativity: 5, speed: 3, accuracy: 9 },
      }),
    );
    router.register(
      mockProvider("fast-cheap"),
      mockCapabilities("fast-cheap", {
        strengthProfile: { reasoning: 5, coding: 5, creativity: 5, speed: 10, accuracy: 5 },
      }),
    );

    const forReasoning = router.selectProvider({ taskType: "reasoning" });
    expect(forReasoning?.name).toBe("slow-smart");

    const forFast = router.selectProvider({ taskType: "fast" });
    expect(forFast?.name).toBe("fast-cheap");
  });

  it("filters by cost tier", () => {
    const router = new ProviderRouter();
    router.register(
      mockProvider("expensive"),
      mockCapabilities("expensive", { costTier: "high" }),
    );
    router.register(
      mockProvider("cheap"),
      mockCapabilities("cheap", { costTier: "low" }),
    );

    const selected = router.selectProvider({ maxCostTier: "low" });
    expect(selected?.name).toBe("cheap");
  });

  it("filters by tool support", () => {
    const router = new ProviderRouter();
    router.register(
      mockProvider("with-tools"),
      mockCapabilities("with-tools", { supportsTools: true }),
    );
    router.register(
      mockProvider("no-tools"),
      mockCapabilities("no-tools", { supportsTools: false }),
    );

    const selected = router.selectProvider({ requireTools: true });
    expect(selected?.name).toBe("with-tools");
  });

  it("routes requests through the selected provider", async () => {
    const router = new ProviderRouter("alpha");
    router.register(mockProvider("alpha"), mockCapabilities("alpha"));

    const request: CompletionRequest = {
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = await router.route(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toContain("alpha");
    }
  });

  it("returns error when no provider matches", async () => {
    const router = new ProviderRouter();

    const result = await router.route({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.ok).toBe(false);
  });
});
