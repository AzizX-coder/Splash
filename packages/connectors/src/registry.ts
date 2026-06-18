import type { ToolDefinition } from "@splash/utils";
import { createLogger } from "@splash/utils";
import type { Connector } from "./connector.js";

const log = createLogger("connectors:registry");

/**
 * ConnectorRegistry manages all available connectors.
 */
export class ConnectorRegistry {
  private connectors = new Map<string, Connector>();

  /** Register a connector. */
  register(connector: Connector): void {
    this.connectors.set(connector.name, connector);
    log.info("Connector registered", { name: connector.name, category: connector.category });
  }

  /** Get a connector by name. */
  get(name: string): Connector | undefined {
    return this.connectors.get(name);
  }

  /** List all registered connectors. */
  list(): Connector[] {
    return Array.from(this.connectors.values());
  }

  /** Get tool definitions from all connectors (for sending to the LLM). */
  allToolDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const connector of this.connectors.values()) {
      defs.push(...connector.toToolDefinitions());
    }
    return defs;
  }

  /** Find the connector that owns a given tool/action name. */
  findByAction(actionName: string): { connector: Connector; action: string } | undefined {
    for (const connector of this.connectors.values()) {
      // Actions are namespaced: "connector_name.action_name"
      if (actionName.startsWith(`${connector.name}.`)) {
        const action = actionName.slice(connector.name.length + 1);
        return { connector, action };
      }
    }
    return undefined;
  }
}
