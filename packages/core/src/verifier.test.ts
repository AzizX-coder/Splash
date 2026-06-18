import { describe, it, expect } from "vitest";
import { Verifier } from "./verifier.js";

describe("Verifier", () => {
  const verifier = new Verifier();

  describe("verifyToolOutput", () => {
    it("passes for successful output", () => {
      const result = verifier.verifyToolOutput("fs.read", {}, "file contents");
      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("fails for error output", () => {
      const result = verifier.verifyToolOutput("fs.read", {}, null, {
        kind: "connector",
        message: "File not found",
        retryable: false,
      });
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("suggests retry for retryable errors", () => {
      const result = verifier.verifyToolOutput("fs.read", {}, null, {
        kind: "connector",
        message: "Network timeout",
        retryable: true,
      });
      expect(result.suggestions.some((s) => s.includes("retryable"))).toBe(true);
    });

    it("flags null output without error", () => {
      const result = verifier.verifyToolOutput("fs.read", {}, null);
      expect(result.passed).toBe(false);
    });

    it("flags non-zero exit codes from terminal", () => {
      const result = verifier.verifyToolOutput(
        "terminal.run",
        {},
        { exitCode: 1, stderr: "command not found" },
      );
      expect(result.passed).toBe(false);
      expect(result.issues.some((i) => i.includes("exit code"))).toBe(true);
    });
  });

  describe("verifyTaskCompletion", () => {
    it("passes when all steps succeed", () => {
      const result = verifier.verifyTaskCompletion("Test task", [
        { description: "Step 1", success: true },
        { description: "Step 2", success: true },
      ]);
      expect(result.passed).toBe(true);
    });

    it("fails when any step fails", () => {
      const result = verifier.verifyTaskCompletion("Test task", [
        { description: "Step 1", success: true },
        { description: "Step 2", success: false },
      ]);
      expect(result.passed).toBe(false);
      expect(result.issues.some((i) => i.includes("Step 2"))).toBe(true);
    });

    it("fails when no steps were executed", () => {
      const result = verifier.verifyTaskCompletion("Test task", []);
      expect(result.passed).toBe(false);
    });
  });
});

describe("Verifier — weighted multi-strategy (spec §2.4)", () => {
  const verifier = new Verifier();

  it("exact strategy passes on identical text and fails otherwise", () => {
    expect(verifier.verifyWeighted([{ name: "x", strategy: { type: "exact", expected: "done" } }], "done").passed).toBe(true);
    expect(verifier.verifyWeighted([{ name: "x", strategy: { type: "exact", expected: "done" } }], "nope").passed).toBe(false);
  });

  it("contains strategy matches substrings case-insensitively", () => {
    const res = verifier.verifyWeighted([{ name: "c", strategy: { type: "contains", expected: "SUCCESS" } }], "operation success!");
    expect(res.passed).toBe(true);
  });

  it("semantic strategy passes on high token overlap", () => {
    const res = verifier.verifyWeighted(
      [{ name: "s", strategy: { type: "semantic", expected: "the quick brown fox", threshold: 0.5 } }],
      "the quick brown fox jumps",
    );
    expect(res.passed).toBe(true);
  });

  it("schema strategy validates object shape and required keys", () => {
    const schema = { type: "object", required: ["id"], properties: { id: { type: "number" } } };
    expect(verifier.verifyWeighted([{ name: "sc", strategy: { type: "schema", schema } }], { id: 5 }).passed).toBe(true);
    expect(verifier.verifyWeighted([{ name: "sc", strategy: { type: "schema", schema } }], { name: "x" }).passed).toBe(false);
    expect(verifier.verifyWeighted([{ name: "sc", strategy: { type: "schema", schema } }], '{"id":7}').passed).toBe(true);
  });

  it("function strategy runs a custom predicate", () => {
    const res = verifier.verifyWeighted([{ name: "fn", strategy: { type: "function", fn: (o) => String(o).length > 3 } }], "hello");
    expect(res.passed).toBe(true);
  });

  it("computes a weighted partial score when some criteria fail", () => {
    const res = verifier.verifyWeighted(
      [
        { name: "a", strategy: { type: "contains", expected: "ok" }, weight: 3 },
        { name: "b", strategy: { type: "contains", expected: "missing" }, weight: 1 },
      ],
      "all ok here",
    );
    expect(res.passed).toBe(false);
    expect(res.score).toBeCloseTo(0.75, 5); // 3 of 4 weight passed
  });

  it("empty criteria => trivially passed with score 1", () => {
    const res = verifier.verifyWeighted([], "anything");
    expect(res.passed).toBe(true);
    expect(res.score).toBe(1);
  });
});
