import type { ConnectorAction, Result, ToolDefinition } from "@splash/utils";
import { ok, err, createError, createLogger } from "@splash/utils";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Connector } from "./connector.js";

const execFileAsync = promisify(execFile);
const log = createLogger("connector:git");

/**
 * Local Git connector — thin wrapper around the `git` CLI with strict
 * allowlisted subcommands so the agent can inspect repositories without
 * being able to push, reset --hard, or reconfigure remotes.
 */
export class GitConnector implements Connector {
  readonly name = "git";
  readonly category = "vcs" as const;
  readonly description = "Inspect and modify a local git repository (read-mostly).";

  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  listActions(): ConnectorAction[] {
    return [
      {
        name: "status",
        description: "Return `git status --porcelain=v1` output and current branch.",
        riskLevel: "safe",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "log",
        description: "Return the last N commits (subject + author + date).",
        riskLevel: "safe",
        parameters: {
          type: "object",
          properties: { limit: { type: "number", description: "Max commits to return (default 10)." } },
        },
      },
      {
        name: "diff",
        description: "Return `git diff` output. Optionally scoped to a single file.",
        riskLevel: "safe",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Optional file path to diff." },
            staged: { type: "boolean", description: "If true, show staged diff." },
          },
        },
      },
      {
        name: "branch",
        description: "Return the list of local branches.",
        riskLevel: "safe",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "add",
        description: "Stage files. Accepts an array of paths.",
        riskLevel: "moderate",
        parameters: {
          type: "object",
          properties: { paths: { type: "array", items: { type: "string" } } },
          required: ["paths"],
        },
      },
      {
        name: "commit",
        description: "Create a commit with the given message from currently-staged changes.",
        riskLevel: "moderate",
        parameters: {
          type: "object",
          properties: { message: { type: "string", description: "Commit message." } },
          required: ["message"],
        },
      },
    ];
  }

  toToolDefinitions(): ToolDefinition[] {
    return this.listActions().map((a) => ({
      name: `${this.name}.${a.name}`,
      description: a.description,
      parameters: a.parameters,
    }));
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("git", ["--version"]);
      return true;
    } catch { return false; }
  }

  async execute(action: string, args: Record<string, unknown>): Promise<Result<unknown>> {
    try {
      switch (action) {
        case "status": {
          const branch = (await this.run(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
          const porcelain = await this.run(["status", "--porcelain=v1"]);
          return ok({ branch, changes: porcelain.split("\n").filter(Boolean) });
        }
        case "log": {
          const limit = Number(args.limit || 10);
          const out = await this.run(["log", `-n${limit}`, "--pretty=%H%x09%an%x09%ad%x09%s", "--date=iso"]);
          const entries = out.split("\n").filter(Boolean).map((line) => {
            const [hash, author, date, ...rest] = line.split("\t");
            return { hash, author, date, subject: rest.join("\t") };
          });
          return ok({ commits: entries });
        }
        case "diff": {
          const argv = ["diff"];
          if (args.staged) argv.push("--staged");
          if (args.path) argv.push("--", String(args.path));
          return ok({ diff: await this.run(argv) });
        }
        case "branch": {
          const out = await this.run(["branch", "--list"]);
          return ok({ branches: out.split("\n").map((s) => s.replace(/^\*\s*/, "").trim()).filter(Boolean) });
        }
        case "add": {
          const paths = (args.paths as string[]) || [];
          if (paths.length === 0) return err(createError("validation", "No paths given to git add"));
          await this.run(["add", ...paths]);
          return ok({ staged: paths });
        }
        case "commit": {
          const msg = String(args.message || "");
          if (!msg.trim()) return err(createError("validation", "Commit message required"));
          const out = await this.run(["commit", "-m", msg]);
          return ok({ output: out });
        }
        default:
          return err(createError("connector", `Unknown git action: ${action}`));
      }
    } catch (e: any) {
      return err(createError("connector", `git ${action} failed: ${e?.stderr || e?.message || e}`));
    }
  }

  private async run(args: string[]): Promise<string> {
    log.debug("git", { args });
    const { stdout } = await execFileAsync("git", args, { cwd: this.cwd, maxBuffer: 5 * 1024 * 1024 });
    return stdout;
  }
}
