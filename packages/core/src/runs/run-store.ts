import * as fs from "node:fs";
import * as path from "node:path";
import { runsDir, logsDir } from "@alpclaw/config";
import type { RunStatus, RunEvent } from "./events.js";

/**
 * Schema v1 run metadata record. Persisted as <runsDir>/<id>.json.
 * Log events append to <logsDir>/<id>.ndjson for postmortems.
 */
export const RUN_SCHEMA_VERSION = 1 as const;

export interface RunRecord {
  schemaVersion: 1;
  id: string;
  task: string;
  mode: "foreground" | "background";
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  phase?: string;
  toolCalls: number;
  steps: number;
  retries: number;
  tokens?: number;
  pid?: number;
  error?: string;
  summary?: string;
}

export class RunStore {
  constructor(
    private readonly dir: string = runsDir(),
    private readonly logs: string = logsDir(),
  ) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.logs, { recursive: true, mode: 0o700 });
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private logPath(id: string): string {
    return path.join(this.logs, `${id}.ndjson`);
  }

  save(rec: RunRecord): void {
    fs.writeFileSync(this.filePath(rec.id), JSON.stringify(rec, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
  }

  get(id: string): RunRecord | null {
    const p = this.filePath(id);
    if (!fs.existsSync(p)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as RunRecord;
      if (raw.schemaVersion !== RUN_SCHEMA_VERSION) return null;
      return raw;
    } catch {
      return null;
    }
  }

  list(): RunRecord[] {
    if (!fs.existsSync(this.dir)) return [];
    const out: RunRecord[] = [];
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      const id = file.slice(0, -5);
      const rec = this.get(id);
      if (rec) out.push(rec);
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  delete(id: string): void {
    const p = this.filePath(id);
    const lp = this.logPath(id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    if (fs.existsSync(lp)) fs.unlinkSync(lp);
  }

  appendEvent(id: string, event: RunEvent): void {
    fs.appendFileSync(this.logPath(id), JSON.stringify(event) + "\n", { encoding: "utf-8" });
  }

  readEvents(id: string): RunEvent[] {
    const p = this.logPath(id);
    if (!fs.existsSync(p)) return [];
    const text = fs.readFileSync(p, "utf-8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as RunEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is RunEvent => e !== null);
  }

  /** Non-blocking tail — returns last N lines. */
  tailEvents(id: string, n: number = 50): RunEvent[] {
    const all = this.readEvents(id);
    return all.slice(Math.max(0, all.length - n));
  }

  /** Stream log events by polling the file. Returns a stop fn. */
  follow(id: string, onEvent: (e: RunEvent) => void, intervalMs: number = 250): () => void {
    const p = this.logPath(id);
    let offset = fs.existsSync(p) ? fs.statSync(p).size : 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      try {
        if (!fs.existsSync(p)) return;
        const size = fs.statSync(p).size;
        if (size > offset) {
          const buf = Buffer.alloc(size - offset);
          const fd = fs.openSync(p, "r");
          fs.readSync(fd, buf, 0, buf.length, offset);
          fs.closeSync(fd);
          offset = size;
          for (const line of buf.toString("utf-8").split("\n")) {
            if (!line) continue;
            try {
              onEvent(JSON.parse(line) as RunEvent);
            } catch {
              // ignore malformed line
            }
          }
        }
      } catch {
        // ignore transient I/O errors
      }
    };
    const timer = setInterval(tick, intervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}
