import { readFile, writeFile, readdir, stat, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ConnectorAction, Result, ToolDefinition } from "@splash/utils";
import { ok, err, createError, createLogger } from "@splash/utils";
import { validateFilePath } from "@splash/safety";
import type { Connector } from "./connector.js";

const log = createLogger("connector:filesystem");

/**
 * Filesystem connector — read, write, list, and manage files.
 */
export class FilesystemConnector implements Connector {
  readonly name = "fs";
  readonly category = "filesystem" as const;
  readonly description = "Read, write, and manage files on the local filesystem";

  private allowedRoots: string[];

  constructor(allowedRoots: string[] = []) {
    this.allowedRoots = allowedRoots.map((r) => resolve(r));
  }

  listActions(): ConnectorAction[] {
    return [
      {
        name: "read",
        description: "Read the contents of a file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to read" },
          },
          required: ["path"],
        },
        riskLevel: "safe",
      },
      {
        name: "write",
        description: "Write content to a file (creates or overwrites)",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to write" },
            content: { type: "string", description: "Content to write" },
          },
          required: ["path", "content"],
        },
        riskLevel: "moderate",
      },
      {
        name: "list",
        description: "List files in a directory",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory path" },
          },
          required: ["path"],
        },
        riskLevel: "safe",
      },
      {
        name: "exists",
        description: "Check if a file or directory exists",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to check" },
          },
          required: ["path"],
        },
        riskLevel: "safe",
      },
      {
        name: "mkdir",
        description: "Create a directory (recursive)",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory path to create" },
          },
          required: ["path"],
        },
        riskLevel: "safe",
      },
      {
        name: "delete",
        description: "Delete a single file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to delete" },
          },
          required: ["path"],
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
    const path = args["path"] as string | undefined;
    if (path) {
      const valid = validateFilePath(path, this.allowedRoots);
      if (!valid.ok) return valid;
    }

    switch (action) {
      case "read":
        return this.readFile(path!);
      case "write":
        return this.writeFile(path!, args["content"] as string);
      case "list":
        return this.listDir(path!);
      case "exists":
        return ok(existsSync(path!));
      case "mkdir":
        return this.mkDir(path!);
      case "delete":
        return this.deleteFile(path!);
      default:
        return err(createError("connector", `Unknown filesystem action: ${action}`));
    }
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private async readFile(path: string): Promise<Result<string>> {
    try {
      const content = await readFile(path, "utf-8");
      log.debug("File read", { path, size: content.length });
      return ok(content);
    } catch (cause) {
      return err(createError("connector", `Failed to read file: ${path}`, { cause }));
    }
  }

  private async writeFile(path: string, content: string): Promise<Result<void>> {
    try {
      const dir = path.replace(/[/\\][^/\\]+$/, "");
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(path, content, "utf-8");
      log.debug("File written", { path, size: content.length });
      return ok(undefined);
    } catch (cause) {
      return err(createError("connector", `Failed to write file: ${path}`, { cause }));
    }
  }

  private async listDir(path: string): Promise<Result<string[]>> {
    try {
      const entries = await readdir(path);
      const detailed: string[] = [];
      for (const entry of entries) {
        const fullPath = join(path, entry);
        try {
          const s = await stat(fullPath);
          detailed.push(`${s.isDirectory() ? "d" : "f"} ${entry}`);
        } catch {
          detailed.push(`? ${entry}`);
        }
      }
      return ok(detailed);
    } catch (cause) {
      return err(createError("connector", `Failed to list directory: ${path}`, { cause }));
    }
  }

  private async mkDir(path: string): Promise<Result<void>> {
    try {
      await mkdir(path, { recursive: true });
      return ok(undefined);
    } catch (cause) {
      return err(createError("connector", `Failed to create directory: ${path}`, { cause }));
    }
  }

  private async deleteFile(path: string): Promise<Result<void>> {
    try {
      await unlink(path);
      log.info("File deleted", { path });
      return ok(undefined);
    } catch (cause) {
      return err(createError("connector", `Failed to delete file: ${path}`, { cause }));
    }
  }
}
