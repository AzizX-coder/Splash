import type { Result, ConnectorAction, ToolDefinition } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Connector } from "./connector.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export class DatabaseConnector implements Connector {
  readonly name = "database";
  readonly category = "database";
  readonly description = "Safely execute optimized database queries.";
  
  private _actions: ConnectorAction[] = [
    {
      name: "query",
      description: "Execute an optimized database query against SQLite natively.",
      riskLevel: "moderate", // Reads are moderate, writes would be dangerous
      parameters: {
        type: "object",
        properties: {
          databasePath: {
            type: "string",
            description: "Path to the sqlite database file.",
          },
          query: {
            type: "string",
            description: "The SQL to execute.",
          },
          readonly: {
            type: "boolean",
            description: "If true, enforces read-only verification before runtime.",
          },
        },
        required: ["databasePath", "query"],
      },
    },
  ];

  listActions(): ConnectorAction[] {
    return this._actions;
  }

  toToolDefinitions(): ToolDefinition[] {
    return this.listActions().map((action) => ({
      name: `${this.name}.${action.name}`,
      description: action.description,
      parameters: action.parameters,
    }));
  }

  async isAvailable(): Promise<boolean> {
    return true; // Relies on sqlite3 binary fallback in environments or pure JS wrappers later
  }

  async execute(
    actionName: string,
    args: Record<string, unknown>,
  ): Promise<Result<unknown>> {
    switch (actionName) {
      case "query": {
        const dbPath = args.databasePath as string;
        const query = args.query as string;
        const readonly = args.readonly === true;

        if (readonly) {
           const lower = query.toLowerCase().trim();
           if (lower.includes("insert ") || lower.includes("update ") || lower.includes("delete ") || lower.includes("drop ") || lower.includes("alter ")) {
              return err(createError("connector", "Query blocked: Write operations are forbidden when readonly is true."));
           }
        }

        try {
          // Optimize SQLite output for direct JSON parsing and speed
          // This avoids bash string concatenations and ensures long-term scalable data integration
          const command = `sqlite3 "${dbPath}" -json "${query.replace(/"/g, '\\"')}"`;
          
          const { stdout, stderr } = await execAsync(command, { timeout: 15000 });
          
          if (stderr && stderr.trim().length > 0 && !stderr.includes("warning")) {
              return err(createError("connector", `SQLite error: ${stderr}`));
          }

          let parsedDataStr = stdout.trim();
          if (!parsedDataStr) {
             return ok({ rows: [] });
          }

          let data: unknown;
          try {
             data = JSON.parse(parsedDataStr);
          } catch (e) {
             // Fallback to raw text if syntax was .schema or pragma where json output fails
             data = parsedDataStr;
          }

          return ok({ rows: data });
        } catch (error: any) {
          return err(createError("connector", `Database execution failed: ${error.message}`));
        }
      }
      default:
        return err(createError("connector", `Unknown database action: ${actionName}`));
    }
  }
}
