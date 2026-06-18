import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import {
  type MemoryEntry,
  type MemoryCategory,
  type Result,
  ok,
  err,
  createError,
  createLogger,
} from "@splash/utils";
import type { MemoryStore } from "./store.js";

const log = createLogger("memory:file");

/**
 * File-based memory store. Stores all entries in a single JSON file.
 * Good for local development and single-agent use.
 */
export class FileMemoryStore implements MemoryStore {
  private filePath: string;
  private entries: Map<string, MemoryEntry> = new Map();
  private loaded = false;

  constructor(storagePath?: string) {
    const baseDir = storagePath ?? join(os.homedir(), ".splash", "memory");
    this.filePath = join(baseDir, "memory.json");
  }

  async save(entry: MemoryEntry): Promise<Result<void>> {
    try {
      await this.ensureLoaded();
      this.entries.set(entry.id, entry);
      await this.persist();
      log.debug("Memory saved", { id: entry.id, category: entry.category, key: entry.key });
      return ok(undefined);
    } catch (cause) {
      return err(createError("memory", "Failed to save memory entry", { cause }));
    }
  }

  async get(id: string): Promise<Result<MemoryEntry | null>> {
    try {
      await this.ensureLoaded();
      return ok(this.entries.get(id) ?? null);
    } catch (cause) {
      return err(createError("memory", "Failed to get memory entry", { cause }));
    }
  }

  async query(category: MemoryCategory, keyPrefix?: string): Promise<Result<MemoryEntry[]>> {
    try {
      await this.ensureLoaded();
      const results: MemoryEntry[] = [];
      for (const entry of this.entries.values()) {
        if (entry.category !== category) continue;
        if (keyPrefix && !entry.key.startsWith(keyPrefix)) continue;
        if (entry.expiresAt && entry.expiresAt < Date.now()) continue;
        results.push(entry);
      }
      return ok(results.sort((a, b) => b.createdAt - a.createdAt));
    } catch (cause) {
      return err(createError("memory", "Failed to query memory", { cause }));
    }
  }

  async search(query: string, limit: number = 10): Promise<Result<MemoryEntry[]>> {
    try {
      await this.ensureLoaded();
      const lower = query.toLowerCase();
      const results: MemoryEntry[] = [];
      for (const entry of this.entries.values()) {
        if (entry.expiresAt && entry.expiresAt < Date.now()) continue;
        if (
          entry.key.toLowerCase().includes(lower) ||
          entry.value.toLowerCase().includes(lower)
        ) {
          results.push(entry);
        }
      }
      return ok(
        results
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, limit),
      );
    } catch (cause) {
      return err(createError("memory", "Failed to search memory", { cause }));
    }
  }

  async delete(id: string): Promise<Result<void>> {
    try {
      await this.ensureLoaded();
      this.entries.delete(id);
      await this.persist();
      return ok(undefined);
    } catch (cause) {
      return err(createError("memory", "Failed to delete memory entry", { cause }));
    }
  }

  async prune(): Promise<Result<number>> {
    try {
      await this.ensureLoaded();
      const now = Date.now();
      let pruned = 0;
      for (const [id, entry] of this.entries) {
        if (entry.expiresAt && entry.expiresAt < now) {
          this.entries.delete(id);
          pruned++;
        }
      }
      if (pruned > 0) {
        await this.persist();
        log.info("Pruned expired memory entries", { count: pruned });
      }
      return ok(pruned);
    } catch (cause) {
      return err(createError("memory", "Failed to prune memory", { cause }));
    }
  }

  async all(): Promise<Result<MemoryEntry[]>> {
    try {
      await this.ensureLoaded();
      return ok(Array.from(this.entries.values()));
    } catch (cause) {
      return err(createError("memory", "Failed to list memory entries", { cause }));
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    if (existsSync(this.filePath)) {
      const raw = await readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw) as MemoryEntry[];
      for (const entry of data) {
        this.entries.set(entry.id, entry);
      }
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const dir = this.filePath.replace(/[/\\][^/\\]+$/, "");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const data = Array.from(this.entries.values());
    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}
