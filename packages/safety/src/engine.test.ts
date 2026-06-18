import { describe, it, expect } from "vitest";
import { SafetyEngine } from "./engine.js";

describe("SafetyEngine", () => {
  describe("strict mode", () => {
    const engine = new SafetyEngine("strict");

    it("allows safe commands", () => {
      const verdict = engine.evaluate("ls -la /home/user");
      expect(verdict.allowed).toBe(true);
      expect(verdict.riskLevel).toBe("safe");
    });

    it("blocks destructive file operations", () => {
      const verdict = engine.evaluate("rm -rf /");
      expect(verdict.allowed).toBe(false);
      expect(verdict.riskLevel).toBe("destructive");
    });

    it("blocks force push", () => {
      const verdict = engine.evaluate("git push --force origin main");
      expect(verdict.allowed).toBe(false);
    });

    it("blocks hard reset", () => {
      const verdict = engine.evaluate("git reset --hard");
      expect(verdict.allowed).toBe(false);
    });

    it("flags secret file access", () => {
      const verdict = engine.evaluate("cat credentials.json");
      expect(verdict.allowed).toBe(false);
    });

    it("flags SQL drop table", () => {
      const verdict = engine.evaluate("DROP TABLE users");
      expect(verdict.allowed).toBe(false);
    });

    it("flags external network POST", () => {
      const verdict = engine.evaluate("curl -d 'data' https://example.com");
      expect(verdict.requiresConfirmation).toBe(true);
      expect(verdict.riskLevel).toBe("moderate");
    });

    it("blocks system kill commands", () => {
      const verdict = engine.evaluate("kill -9 1234");
      expect(verdict.allowed).toBe(false);
    });
  });

  describe("standard mode", () => {
    const engine = new SafetyEngine("standard");

    it("allows safe commands", () => {
      const verdict = engine.evaluate("git status");
      expect(verdict.allowed).toBe(true);
    });

    it("blocks destructive operations", () => {
      const verdict = engine.evaluate("rm -rf /var/data");
      expect(verdict.allowed).toBe(false);
    });

    it("requires confirmation for dangerous SQL", () => {
      const verdict = engine.evaluate("DELETE FROM users WHERE id = 5");
      expect(verdict.requiresConfirmation).toBe(true);
    });

    it("allows read-only SQL", () => {
      const verdict = engine.evaluate("SELECT * FROM users");
      expect(verdict.allowed).toBe(true);
      expect(verdict.riskLevel).toBe("safe");
    });
  });

  describe("permissive mode", () => {
    const engine = new SafetyEngine("permissive");

    it("allows dangerous operations", () => {
      const verdict = engine.evaluate("DELETE FROM old_records");
      expect(verdict.allowed).toBe(true);
    });

    it("still requires confirmation for destructive ops", () => {
      const verdict = engine.evaluate("rm -rf /data");
      expect(verdict.allowed).toBe(true);
      expect(verdict.requiresConfirmation).toBe(true);
    });
  });

  describe("custom blocked patterns", () => {
    const engine = new SafetyEngine("permissive", ["prod-deploy", "DROP\\s+DATABASE"]);

    it("blocks custom patterns regardless of mode", () => {
      const verdict = engine.evaluate("run prod-deploy script");
      expect(verdict.allowed).toBe(false);
    });

    it("blocks custom regex patterns", () => {
      const verdict = engine.evaluate("DROP DATABASE mydb");
      expect(verdict.allowed).toBe(false);
    });
  });

  describe("mode switching", () => {
    it("can change mode at runtime", () => {
      const engine = new SafetyEngine("strict");
      expect(engine.getMode()).toBe("strict");

      engine.setMode("permissive");
      expect(engine.getMode()).toBe("permissive");

      // Now previously blocked operations are allowed
      const verdict = engine.evaluate("DELETE FROM users");
      expect(verdict.allowed).toBe(true);
    });
  });
});

describe("SafetyEngine — credential redaction (T0.5)", () => {
  const engine = new SafetyEngine("standard");

  it("redacts an OpenAI-style key", () => {
    const text = "here is the key sk-abcdefghijklmnopqrstuvwxyz0123456789 use it";
    const out = engine.redactCredentials(text);
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(out).toContain("[REDACTED:openai-key]");
  });

  it("redacts a Slack token", () => {
    const out = engine.redactCredentials("token=xoxb-1234567890-abcdef");
    expect(out).toContain("[REDACTED:slack-token]");
  });

  it("redacts a Google API key", () => {
    const out = engine.redactCredentials("key AIzaSyA1234567890123456789012345678901234");
    expect(out).toContain("[REDACTED:google-key]");
  });

  it("leaves clean text untouched", () => {
    const clean = "the build completed successfully in 500ms";
    expect(engine.redactCredentials(clean)).toBe(clean);
  });

  it("handles empty input", () => {
    expect(engine.redactCredentials("")).toBe("");
  });
});
