import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { generateId } from "@alpclaw/utils";
import { AlpClaw } from "../alpclaw.js";
import type { AgentPhase, Task } from "@alpclaw/utils";
import { RunStore, type RunRecord } from "./run-store.js";
import type { RunEvent, RunStatus } from "./events.js";

/**
 * Lifecycle + persistence + event stream for agent runs.
 *
 * Usage:
 *   const rm = new RunManager();
 *   const { id } = await rm.start("build a bot", { background: false });
 *   for await (const e of rm.stream(id)) { ... }
 */
export class RunManager extends EventEmitter {
  private readonly store: RunStore;
  private readonly inFlight = new Map<string, AbortController>();

  constructor(store?: RunStore) {
    super();
    this.store = store || new RunStore();
  }

  list(): RunRecord[] {
    return this.store.list();
  }

  get(id: string): RunRecord | null {
    return this.store.get(id);
  }

  events(id: string): RunEvent[] {
    return this.store.readEvents(id);
  }

  /** Start a run. Foreground returns when task finishes; background returns immediately. */
  async start(
    task: string,
    opts: { background?: boolean; retryOf?: string } = {},
  ): Promise<{ id: string; record: RunRecord }> {
    const id = opts.retryOf ? generateId("run") : generateId("run");
    const now = new Date().toISOString();
    const record: RunRecord = {
      schemaVersion: 1,
      id,
      task,
      mode: opts.background ? "background" : "foreground",
      status: "queued",
      createdAt: now,
      toolCalls: 0,
      steps: 0,
      retries: 0,
    };
    this.store.save(record);
    this.writeEvent({ type: "RunCreated", runId: id, at: now, task, mode: record.mode });

    if (opts.background) {
      this.spawnBackground(id, task);
      return { id, record };
    }

    await this.runInline(id, task);
    const final = this.store.get(id);
    return { id, record: final || record };
  }

  /** Cancel a running run. */
  stop(id: string, reason = "user cancelled"): boolean {
    const rec = this.store.get(id);
    if (!rec) return false;
    if (rec.status !== "running" && rec.status !== "queued") return false;

    const ctrl = this.inFlight.get(id);
    if (ctrl) ctrl.abort();

    if (rec.pid) {
      try {
        process.kill(rec.pid, "SIGTERM");
      } catch {
        // process already gone
      }
    }

    this.transition(id, "cancelled");
    this.writeEvent({ type: "RunCancelled", runId: id, at: new Date().toISOString(), reason });
    return true;
  }

  /** Retry a finished run. Returns the new run id. */
  async retry(id: string, opts: { background?: boolean } = {}): Promise<{ id: string; record: RunRecord }> {
    const rec = this.store.get(id);
    if (!rec) throw new Error(`Unknown run: ${id}`);
    return this.start(rec.task, { background: opts.background, retryOf: id });
  }

  /** Follow logs for a run. Returns a stop fn. */
  follow(id: string, onEvent: (e: RunEvent) => void): () => void {
    for (const e of this.store.tailEvents(id, 200)) onEvent(e);
    return this.store.follow(id, onEvent);
  }

  // ── internal ────────────────────────────────────────────────────────────

  private writeEvent(e: RunEvent): void {
    this.store.appendEvent(e.runId, e);
    this.emit("event", e);
  }

  private transition(id: string, status: RunStatus, patch: Partial<RunRecord> = {}): void {
    const rec = this.store.get(id);
    if (!rec) return;
    const next: RunRecord = { ...rec, ...patch, status };
    if (status === "running" && !next.startedAt) next.startedAt = new Date().toISOString();
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      next.endedAt = new Date().toISOString();
    }
    this.store.save(next);
  }

  private async runInline(id: string, task: string): Promise<void> {
    const ctrl = new AbortController();
    this.inFlight.set(id, ctrl);

    const now = () => new Date().toISOString();
    this.transition(id, "running");
    this.writeEvent({ type: "RunStarted", runId: id, at: now() });

    let toolCalls = 0;

    try {
      const alpclaw = await AlpClaw.create();
      const agent = alpclaw.createAgent({
        onPhaseChange: (phase: AgentPhase) => {
          this.store.save({ ...(this.store.get(id) as RunRecord), phase });
          this.writeEvent({ type: "PhaseChanged", runId: id, at: now(), phase });
        },
        onToolCall: (tool: string, args: Record<string, unknown>) => {
          toolCalls++;
          this.writeEvent({ type: "ToolCalled", runId: id, at: now(), tool, args });
          if (tool === "web-tool") {
             if (args["action"] === "search" && args["query"]) {
                this.writeEvent({ type: "WebSearch", runId: id, at: now(), query: String(args["query"]), resultsCount: 0 });
             } else if ((args["action"] === "scrape" || args["action"] === "fetch") && args["url"]) {
                this.writeEvent({ type: "WebCrawl", runId: id, at: now(), url: String(args["url"]), success: true });
             }
          }
        },
        onStepComplete: () => {
          const r = this.store.get(id);
          if (r) this.store.save({ ...r, steps: r.steps + 1, toolCalls });
        },
        onError: (error: string, phase: AgentPhase) => {
          this.writeEvent({ type: "LogLine", runId: id, at: now(), level: "error", text: `[${phase}] ${error}` });
        },
        onCacheHit: (key: string) => {
          this.writeEvent({ type: "CacheHit", runId: id, at: now(), key });
        },
        onConfirmationRequired: async () => true, // background = auto-allow; foreground CLI wraps this separately
      });

      const result = await agent.run(task);
      if (ctrl.signal.aborted) {
        this.transition(id, "cancelled");
        return;
      }
      if (result.ok) {
        const t: Task = result.value;
        this.transition(id, "succeeded", {
          steps: t.steps.length,
          toolCalls,
          tokens: t.result?.tokens,
          summary: t.result?.summary,
        });
        this.writeEvent({
          type: "RunCompleted",
          runId: id,
          at: now(),
          steps: t.steps.length,
          summary: t.result?.summary,
        });
      } else {
        this.transition(id, "failed", { error: result.error.message, toolCalls });
        this.writeEvent({ type: "RunFailed", runId: id, at: now(), error: result.error.message });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.transition(id, "failed", { error: msg });
      this.writeEvent({ type: "RunFailed", runId: id, at: new Date().toISOString(), error: msg });
    } finally {
      this.inFlight.delete(id);
    }
  }

  private spawnBackground(id: string, task: string): void {
    // Find bin/splash.mjs launcher so we can re-exec ourselves with a detached child.
    const splashHome = process.env.SPLASH_HOME || process.env.ALPCLAW_HOME || process.cwd();
    const launcher = path.join(splashHome, "bin", "splash.mjs");

    if (!fs.existsSync(launcher)) {
      // Fall back: run inline synchronously but don't block caller — fire and forget.
      void this.runInline(id, task);
      return;
    }

    const child = spawn(process.execPath, [launcher, "_worker", id, task], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, SPLASH_WORKER_RUN_ID: id },
    });

    if (child.pid) {
      const rec = this.store.get(id);
      if (rec) this.store.save({ ...rec, pid: child.pid });
    }
    child.unref();
  }
}

/** Entry point invoked by `splash _worker <id> <task>` in background mode. */
export async function runWorker(id: string, task: string): Promise<void> {
  const rm = new RunManager();
  // Replace the would-be new run with one that uses the pre-allocated id.
  // Simplest: directly invoke runInline via a subclass that skips creation.
  (rm as any).inFlight.set(id, new AbortController());
  const record = rm.get(id);
  if (!record) {
    const now = new Date().toISOString();
    (rm as any).store.save({
      schemaVersion: 1,
      id,
      task,
      mode: "background",
      status: "queued",
      createdAt: now,
      toolCalls: 0,
      steps: 0,
      retries: 0,
    });
  }
  await (rm as any).runInline(id, task);
}
