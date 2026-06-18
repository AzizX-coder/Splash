import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { FileMemoryStore } from "./file-store.js";
import { MemoryManager } from "./manager.js";

const TEST_PATH = ".splash/test-memory";

describe("FileMemoryStore", () => {
  let store: FileMemoryStore;

  beforeEach(() => {
    store = new FileMemoryStore(TEST_PATH);
  });

  afterEach(async () => {
    try {
      await rm(TEST_PATH, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("saves and retrieves an entry", async () => {
    const entry = {
      id: "test_001",
      category: "project" as const,
      key: "test-key",
      value: "test-value",
      metadata: { source: "test" },
      createdAt: Date.now(),
    };

    const saveResult = await store.save(entry);
    expect(saveResult.ok).toBe(true);

    const getResult = await store.get("test_001");
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.value?.value).toBe("test-value");
    }
  });

  it("queries by category", async () => {
    await store.save({
      id: "p1", category: "project", key: "a", value: "v1",
      metadata: {}, createdAt: Date.now(),
    });
    await store.save({
      id: "u1", category: "user", key: "b", value: "v2",
      metadata: {}, createdAt: Date.now(),
    });
    await store.save({
      id: "p2", category: "project", key: "c", value: "v3",
      metadata: {}, createdAt: Date.now(),
    });

    const result = await store.query("project");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2);
    }
  });

  it("searches by content", async () => {
    await store.save({
      id: "s1", category: "context", key: "setup", value: "TypeScript monorepo with pnpm",
      metadata: {}, createdAt: Date.now(),
    });
    await store.save({
      id: "s2", category: "context", key: "deploy", value: "Docker on AWS",
      metadata: {}, createdAt: Date.now(),
    });

    const result = await store.search("TypeScript");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(1);
      expect(result.value[0]!.key).toBe("setup");
    }
  });

  it("deletes entries", async () => {
    await store.save({
      id: "d1", category: "task", key: "temp", value: "temporary",
      metadata: {}, createdAt: Date.now(),
    });

    await store.delete("d1");

    const result = await store.get("d1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("prunes expired entries", async () => {
    await store.save({
      id: "exp1", category: "task", key: "expired", value: "old",
      metadata: {}, createdAt: Date.now() - 100000,
      expiresAt: Date.now() - 1000, // already expired
    });
    await store.save({
      id: "valid1", category: "task", key: "valid", value: "current",
      metadata: {}, createdAt: Date.now(),
    });

    const pruned = await store.prune();
    expect(pruned.ok).toBe(true);
    if (pruned.ok) {
      expect(pruned.value).toBe(1);
    }

    const all = await store.all();
    if (all.ok) {
      expect(all.value.length).toBe(1);
    }
  });
});

describe("MemoryManager", () => {
  let manager: MemoryManager;

  beforeEach(() => {
    const store = new FileMemoryStore(TEST_PATH);
    manager = new MemoryManager(store);
  });

  afterEach(async () => {
    try {
      await rm(TEST_PATH, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("remembers and recalls", async () => {
    const result = await manager.remember("project", "stack", "TypeScript");
    expect(result.ok).toBe(true);

    const recalled = await manager.recall("project");
    expect(recalled.ok).toBe(true);
    if (recalled.ok) {
      expect(recalled.value.length).toBe(1);
      expect(recalled.value[0]!.value).toBe("TypeScript");
    }
  });

  it("records decisions", async () => {
    const result = await manager.recordDecision("task_123", "Use Claude", "Best for reasoning");
    expect(result.ok).toBe(true);

    const recalled = await manager.recall("decision", "task:");
    expect(recalled.ok).toBe(true);
    if (recalled.ok) {
      expect(recalled.value.length).toBe(1);
    }
  });

  it("records failures", async () => {
    await manager.recordFailure("task_123", "Timeout error", "Tried API call");

    const recalled = await manager.recall("failure");
    expect(recalled.ok).toBe(true);
    if (recalled.ok) {
      expect(recalled.value.length).toBe(1);
    }
  });

  it("gets relevant context", async () => {
    await manager.remember("context", "lang", "TypeScript project");
    await manager.remember("context", "deploy", "Docker on Kubernetes");

    const context = await manager.getRelevantContext("TypeScript");
    expect(context.length).toBeGreaterThan(0);
    expect(context[0]).toContain("TypeScript");
  });
});
