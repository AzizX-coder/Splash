/**
 * Typed event model for the run orchestration layer.
 * Consumed by both TUI and CLI text views.
 */

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface BaseEvent {
  runId: string;
  at: string; // ISO timestamp
}

export interface RunCreated extends BaseEvent {
  type: "RunCreated";
  task: string;
  mode: "foreground" | "background";
}

export interface RunStarted extends BaseEvent {
  type: "RunStarted";
}

export interface PhaseChanged extends BaseEvent {
  type: "PhaseChanged";
  phase: string;
}

export interface ToolCalled extends BaseEvent {
  type: "ToolCalled";
  tool: string;
  args?: unknown;
}

export interface LogLine extends BaseEvent {
  type: "LogLine";
  level: "info" | "warn" | "error" | "debug";
  text: string;
}

export interface RunCompleted extends BaseEvent {
  type: "RunCompleted";
  summary?: string;
  steps?: number;
}

export interface RunFailed extends BaseEvent {
  type: "RunFailed";
  error: string;
}

export interface RunCancelled extends BaseEvent {
  type: "RunCancelled";
  reason?: string;
}

export interface CacheHit extends BaseEvent {
  type: "CacheHit";
  key: string;
}

export interface WebSearch extends BaseEvent {
  type: "WebSearch";
  query: string;
  resultsCount: number;
}

export interface WebCrawl extends BaseEvent {
  type: "WebCrawl";
  url: string;
  success: boolean;
}

export type RunEvent =
  | RunCreated
  | RunStarted
  | PhaseChanged
  | ToolCalled
  | LogLine
  | RunCompleted
  | RunFailed
  | RunCancelled
  | CacheHit
  | WebSearch
  | WebCrawl;
