import type {
  ConnectorAction,
  ConnectorCategory,
  Result,
  ToolDefinition,
} from "@splash/utils";

/**
 * Interface that all connectors must implement.
 * A connector wraps an external tool/service behind a uniform API.
 */
export interface Connector {
  /** Unique name for this connector. */
  readonly name: string;

  /** Category of this connector. */
  readonly category: ConnectorCategory;

  /** Human-readable description. */
  readonly description: string;

  /** List all actions this connector can perform. */
  listActions(): ConnectorAction[];

  /** Convert actions to tool definitions for the LLM. */
  toToolDefinitions(): ToolDefinition[];

  /** Execute an action by name with given arguments. */
  execute(action: string, args: Record<string, unknown>): Promise<Result<unknown>>;

  /** Check if the connector is available/configured. */
  isAvailable(): Promise<boolean>;
}
