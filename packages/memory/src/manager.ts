import {
  type MemoryEntry,
  type MemoryCategory,
  type Result,
  ok,
  generateId,
  createLogger,
} from "@splash/utils";
import type { MemoryStore } from "./store.js";
import { EpisodicMemory } from "./episodic.js";
import { SemanticMemory } from "./semantic.js";
import { UserProfile } from "./profile.js";
import { SkillMemory } from "./skill-memory.js";
import { TrashMemory, type TrashCategory } from "./trash.js";

const log = createLogger("memory");

/**
 * MemoryManager provides a high-level API over a MemoryStore.
 * It handles ID generation, timestamps, and convenience methods.
 */
export class MemoryManager {
  public readonly episodic = new EpisodicMemory();
  public readonly semantic = new SemanticMemory();
  public readonly profile = new UserProfile();
  public readonly skills = new SkillMemory();
  public readonly trash = new TrashMemory();

  constructor(private store: MemoryStore) {}

  /** Remember a piece of information. */
  async remember(
    category: MemoryCategory,
    key: string,
    value: string,
    metadata: Record<string, unknown> = {},
    ttlMs?: number,
  ): Promise<Result<MemoryEntry>> {
    const entry: MemoryEntry = {
      id: generateId("mem"),
      category,
      key,
      value,
      metadata,
      createdAt: Date.now(),
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    };

    const result = await this.store.save(entry);
    if (!result.ok) return result;

    log.debug("Remembered", { category, key });
    return ok(entry);
  }

  /** Recall entries by category. */
  async recall(category: MemoryCategory, keyPrefix?: string): Promise<Result<MemoryEntry[]>> {
    return this.store.query(category, keyPrefix);
  }

  /** Search across all memory. */
  async search(query: string, limit?: number): Promise<Result<MemoryEntry[]>> {
    return this.store.search(query, limit);
  }

  /** Forget a specific entry. */
  async forget(id: string): Promise<Result<void>> {
    return this.store.delete(id);
  }

  /** Clean up expired memories. */
  async cleanup(): Promise<Result<number>> {
    return this.store.prune();
  }

  /** Record a task decision for future reference. */
  async recordDecision(
    taskId: string,
    decision: string,
    reasoning: string,
  ): Promise<Result<MemoryEntry>> {
    return this.remember("decision", `task:${taskId}`, decision, { reasoning });
  }

  /** Record a failure for learning. */
  async recordFailure(
    taskId: string,
    error: string,
    attempted: string,
  ): Promise<Result<MemoryEntry>> {
    return this.remember("failure", `task:${taskId}`, error, { attempted });
  }

  /** Get context relevant to a query. */
  async getRelevantContext(query: string, limit: number = 5): Promise<string[]> {
    const result = await this.store.search(query, limit);
    if (!result.ok) return [];
    return result.value.map((e) => `[${e.category}:${e.key}] ${e.value}`);
  }

  /** Get a summary of items in trash by category */
  async trashSummary(): Promise<Record<TrashCategory | "total", number>> {
    const entries = this.trash.list();
    const counts = {
      adversarial: 0,
      noisy: 0,
      failed: 0,
      overshoot: 0,
      unsafe: 0,
      total: entries.length,
    };
    for (const e of entries) {
      if (counts[e.category] !== undefined) {
        counts[e.category]++;
      }
    }
    return counts;
  }
}
