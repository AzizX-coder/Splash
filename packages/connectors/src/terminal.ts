import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ConnectorAction, Result, ToolDefinition } from "@splash/utils";
import { ok, err, createError, createLogger } from "@splash/utils";
import { validateNoInjection } from "@splash/safety";
import type { Connector } from "./connector.js";

const execFileAsync = promisify(execFile);
const log = createLogger("connector:terminal");

/**
 * Terminal connector — run shell commands safely.
 */
export class TerminalConnector implements Connector {
  readonly name = "terminal";
  readonly category = "terminal" as const;
  readonly description = "Execute shell commands and scripts";

  private shell: string;
  private timeoutMs: number;
  private cwd?: string;

  constructor(opts?: { shell?: string; timeoutMs?: number; cwd?: string }) {
    this.shell = opts?.shell || (process.platform === "win32" ? "cmd.exe" : "/bin/bash");
    this.timeoutMs = opts?.timeoutMs || 30000;
    this.cwd = opts?.cwd;
  }

  listActions(): ConnectorAction[] {
    return [
      {
        name: "run",
        description: "Execute a shell command and return stdout/stderr",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "The command to execute" },
            cwd: { type: "string", description: "Working directory (optional)" },
            timeout: { type: "number", description: "Timeout in ms (optional)" },
          },
          required: ["command"],
        },
        riskLevel: "dangerous",
      },
    ];
  }

  toToolDefinitions(): ToolDefinition[] {
    return this.listActions().map((action) => ({
      name: `${this.name}.${action.name}`,
      description: action.description,
      parameters: action.parameters,
    }));
  }

  async execute(action: string, args: Record<string, unknown>): Promise<Result<unknown>> {
    if (action !== "run") {
      return err(createError("connector", `Unknown terminal action: ${action}`));
    }

    const command = args["command"] as string;
    if (!command) {
      return err(createError("validation", "Command is required"));
    }

    // Validate against injection patterns
    const valid = validateNoInjection(command);
    if (!valid.ok) return valid;

    return this.runCommand(
      command,
      (args["cwd"] as string) || this.cwd,
      (args["timeout"] as number) || this.timeoutMs,
    );
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private async runCommand(
    command: string,
    cwd?: string,
    timeout?: number,
  ): Promise<Result<{ stdout: string; stderr: string; exitCode: number }>> {
    try {
      log.debug("Executing command", { command: command.slice(0, 80), cwd });

      const shellFlag = this.shell.includes("cmd") ? "/c" : "-c";

      const { stdout, stderr } = await execFileAsync(this.shell, [shellFlag, command], {
        cwd,
        timeout: timeout || this.timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        windowsHide: true,
      });

      log.debug("Command completed", {
        stdoutLen: stdout.length,
        stderrLen: stderr.length,
      });

      return ok({ stdout, stderr, exitCode: 0 });
    } catch (cause: unknown) {
      const execError = cause as { stdout?: string; stderr?: string; code?: number; killed?: boolean };

      if (execError.killed) {
        return err(createError("timeout", `Command timed out after ${timeout}ms`, { cause }));
      }

      // Command ran but returned non-zero exit code
      if (execError.stdout !== undefined || execError.stderr !== undefined) {
        return ok({
          stdout: execError.stdout || "",
          stderr: execError.stderr || "",
          exitCode: execError.code || 1,
        });
      }

      return err(createError("connector", "Command execution failed", { cause, retryable: true }));
    }
  }
}
