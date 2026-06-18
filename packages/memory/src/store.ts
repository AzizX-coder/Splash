import type { MemoryEntry, MemoryCategory, Result } from "@splash/utils";

/**
 * Interface for memory storage backends.
 * Implementations can be file-based, database-backed, etc.
 */
export interface MemoryStore {
  /** Save or update a memory entry. */
  save(entry: MemoryEntry): Promise<Result<void>>;

  /** Get a single entry by ID. */
  get(id: string): Promise<Result<MemoryEntry | null>>;

  /** Find entries by category and optional key prefix. */
  query(category: MemoryCategory, keyPrefix?: string): Promise<Result<MemoryEntry[]>>;

  /** Search entries by value content. */
  search(query: string, limit?: number): Promise<Result<MemoryEntry[]>>;

  /** Delete an entry by ID. */
  delete(id: string): Promise<Result<void>>;

  /** Delete expired entries. */
  prune(): Promise<Result<number>>;

  /** Get all entries (for export/debug). */
  all(): Promise<Result<MemoryEntry[]>>;
}
