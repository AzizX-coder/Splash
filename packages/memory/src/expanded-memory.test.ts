import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EpisodicMemory } from "./episodic.js";
import { UserProfile } from "./profile.js";
import { SkillMemory } from "./skill-memory.js";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

// Use a temporary test directory instead of the real config dir
const TEST_DIR = path.join(os.tmpdir(), "alpclaw-memory-test-" + Date.now());

vi.mock("@alpclaw/config", () => ({
  globalConfigDir: () => TEST_DIR
}));

describe("Hermes-Grade Memory Expansion", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("EpisodicMemory", () => {
    it("should append and retrieve last N messages", async () => {
      const memory = new EpisodicMemory();
      memory.append("sess1", { role: "user", content: "hello", timestamp: "123" });
      memory.append("sess1", { role: "bot", content: "hi", timestamp: "124" });
      
      const last1 = await memory.getLastNMessages("sess1", 1);
      expect(last1).toHaveLength(1);
      expect(last1[0]?.content).toBe("hi");

      const last2 = await memory.getLastNMessages("sess1", 2);
      expect(last2).toHaveLength(2);
      expect(last2[0]?.content).toBe("hello");
    });

    it("should search messages across sessions", async () => {
      const memory = new EpisodicMemory();
      memory.append("sess1", { role: "user", content: "find this string", timestamp: "1" });
      memory.append("sess2", { role: "user", content: "some other string", timestamp: "2" });
      memory.append("sess2", { role: "bot", content: "find this too", timestamp: "3" });

      const results = await memory.search("find this");
      expect(results).toHaveLength(2);
      expect(results.some(r => r.sessionId === "sess1" && r.message.content.includes("string"))).toBe(true);
      expect(results.some(r => r.sessionId === "sess2" && r.message.content.includes("too"))).toBe(true);
    });
  });

  describe("UserProfile", () => {
    it("should read and update user profile", () => {
      const profile = new UserProfile();
      let data = profile.read();
      expect(data).toEqual({});

      profile.update({ name: "Alice", tone: "helpful" });
      data = profile.read();
      expect(data.name).toBe("Alice");
      expect(data.tone).toBe("helpful");

      profile.update({ timezone: "UTC" });
      data = profile.read();
      expect(data.name).toBe("Alice");
      expect(data.timezone).toBe("UTC");
    });
  });

  describe("SkillMemory", () => {
    it("should record and retrieve skill stats", () => {
      const skills = new SkillMemory();
      skills.record("test-skill", true);
      skills.record("test-skill", false);
      skills.record("test-skill", true);

      const stats = skills.getStats();
      expect(stats["test-skill"]?.successCount).toBe(2);
      expect(stats["test-skill"]?.failureCount).toBe(1);
      expect(stats["test-skill"]?.lastUsed).toBeDefined();
    });
  });
});
