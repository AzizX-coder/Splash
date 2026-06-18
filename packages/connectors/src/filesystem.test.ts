import { describe, it, expect, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { FilesystemConnector } from "./filesystem.js";

const TEST_DIR = ".splash/test-fs";

describe("FilesystemConnector", () => {
  const fs = new FilesystemConnector();

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("lists actions", () => {
    const actions = fs.listActions();
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.map((a) => a.name)).toContain("read");
    expect(actions.map((a) => a.name)).toContain("write");
    expect(actions.map((a) => a.name)).toContain("list");
  });

  it("generates tool definitions", () => {
    const tools = fs.toToolDefinitions();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]!.name).toMatch(/^fs\./);
  });

  it("writes and reads a file", async () => {
    const writePath = `${TEST_DIR}/test.txt`;
    const writeResult = await fs.execute("write", { path: writePath, content: "hello world" });
    expect(writeResult.ok).toBe(true);

    const readResult = await fs.execute("read", { path: writePath });
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value).toBe("hello world");
    }
  });

  it("checks file existence", async () => {
    await mkdir(TEST_DIR, { recursive: true });

    const exists = await fs.execute("exists", { path: TEST_DIR });
    expect(exists.ok).toBe(true);
    if (exists.ok) expect(exists.value).toBe(true);

    const notExists = await fs.execute("exists", { path: `${TEST_DIR}/nope.txt` });
    expect(notExists.ok).toBe(true);
    if (notExists.ok) expect(notExists.value).toBe(false);
  });

  it("creates directories", async () => {
    const dirPath = `${TEST_DIR}/nested/deep/dir`;
    const result = await fs.execute("mkdir", { path: dirPath });
    expect(result.ok).toBe(true);
    expect(existsSync(dirPath)).toBe(true);
  });

  it("rejects path traversal", async () => {
    const connector = new FilesystemConnector(["/safe/root"]);
    const result = await connector.execute("read", { path: "../../etc/passwd" });
    expect(result.ok).toBe(false);
  });

  it("is always available", async () => {
    expect(await fs.isAvailable()).toBe(true);
  });
});
