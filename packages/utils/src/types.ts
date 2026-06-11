/**
 * Core types used across all AlpClaw packages.
 */

// ─── Result Type ─────────────────────────────────────────────────────────────

export type Result<T, E = AlpClawError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ─── Error Types ─────────────────────────────────────────────────────────────

export type ErrorKind =
  | "validation"
  | "provider"
  | "connector"
  | "safety"
  | "memory"
  | "skill"
  | "task"
  | "config"
  | "timeout"
  | "internal";

export interface AlpClawError {
  kind: ErrorKind;
  message: string;
  cause?: unknown;
  retryable: boolean;
}

export function createError(
  kind: ErrorKind,
  message: string,
  opts?: { cause?: unknown; retryable?: boolean },
): AlpClawError {
  return {
    kind,
    message,
    cause: opts?.cause,
    retryable: opts?.retryable ?? false,
  };
}

// ─── Task Types ──────────────────────────────────────────────────────────────

export type TaskStatus =
  | "pending"
  | "planning"
  | "executing"
  | "verifying"
  | "correcting"
  | "completed"
  | "failed"
  | "blocked";

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  steps: TaskStep[];
  context: TaskContext;
  result?: TaskResult;
  parentId?: string;
  retries: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskStep {
  id: string;
  description: string;
  status: TaskStatus;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  output?: unknown;
  error?: AlpClawError;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskContext {
  userIntent: string;
  relevantFiles?: string[];
  memoryKeys?: string[];
  metadata: Record<string, unknown>;
}

export interface TaskResult {
  success: boolean;
  output: unknown;
  summary: string;
  artifacts?: string[];
  tokens?: number;
}

// ─── Provider Types ──────────────────────────────────────────────────────────

export type ProviderName =
  | "claude"
  | "openai"
  | "gemini"
  | "deepseek"
  | "local"
  | "nous"
  | "groq"
  | "mistral"
  | "cerebras"
  | "cohere"
  | "nvidia"
  | "openrouter"
  | "ollama"
  | string;

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface CompletionRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  model?: string;
  responseFormat?: { type: "json_object" | "text" };
}

export interface CompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  model: string;
  finishReason: "stop" | "tool_calls" | "length" | "error";
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ─── Connector Types ─────────────────────────────────────────────────────────

export type ConnectorCategory =
  | "filesystem"
  | "terminal"
  | "vcs"
  | "browser"
  | "database"
  | "messaging"
  | "webhook"
  | "api";

export interface ConnectorAction {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  riskLevel: RiskLevel;
}

export type RiskLevel = "safe" | "moderate" | "dangerous" | "destructive";

// ─── Safety Types ────────────────────────────────────────────────────────────

export type SafetyMode = "strict" | "standard" | "permissive";

export interface SafetyVerdict {
  allowed: boolean;
  reason?: string;
  requiresConfirmation: boolean;
  riskLevel: RiskLevel;
  mitigations?: string[];
}

// ─── Memory Types ────────────────────────────────────────────────────────────

export type MemoryCategory =
  | "project"
  | "user"
  | "task"
  | "decision"
  | "failure"
  | "context";

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  key: string;
  value: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  expiresAt?: number;
}

// ─── Skill Types ─────────────────────────────────────────────────────────────

export interface SkillManifest {
  name: string;
  description: string;
  version: string;
  tags: string[];
  requiredConnectors: string[];
  parameters: Record<string, unknown>; // JSON Schema
}

export interface SkillResult {
  success: boolean;
  output: unknown;
  summary: string;
  sideEffects?: string[];
}

// ─── Agent Loop Types ────────────────────────────────────────────────────────

export type AgentPhase =
  | "intake"
  | "understand"
  | "plan"
  | "context_fetch"
  | "tool_select"
  | "execute"
  | "verify"
  | "correct"
  | "finalize"
  | "persist";

export interface AgentState {
  phase: AgentPhase;
  task: Task;
  plan: string[];
  selectedTools: string[];
  executionLog: ExecutionEntry[];
  correctionAttempts: number;
}

export interface ExecutionEntry {
  phase: AgentPhase;
  action: string;
  input?: unknown;
  output?: unknown;
  error?: AlpClawError;
  timestamp: number;
  durationMs: number;
}
