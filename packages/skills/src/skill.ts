import type { SkillManifest, SkillResult, Result } from "@splash/utils";

/**
 * A Skill is a reusable, composable unit of agent behavior.
 * Skills combine provider calls and connector actions into higher-level operations.
 */
export interface Skill {
  /** Skill metadata and parameter schema. */
  readonly manifest: SkillManifest;

  /**
   * Execute the skill with given parameters.
   * The context provides access to providers and connectors.
   */
  execute(params: Record<string, unknown>, context: SkillContext): Promise<Result<SkillResult>>;
}

/**
 * Context passed to skills during execution.
 * Provides access to other system capabilities without tight coupling.
 */
export interface SkillContext {
  /** Execute a connector action. */
  runConnector(connectorAction: string, args: Record<string, unknown>): Promise<Result<unknown>>;

  /** Send a completion request to the model provider. */
  complete(prompt: string, opts?: { model?: string; temperature?: number }): Promise<Result<string>>;

  /** Log a message from the skill. */
  log(message: string, data?: Record<string, unknown>): void;
}
