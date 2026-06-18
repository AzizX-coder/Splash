import type { ConnectorAction, Result, ToolDefinition } from "@splash/utils";
import { ok, err, createError, createLogger } from "@splash/utils";
import type { Connector } from "./connector.js";

const log = createLogger("connector:github");

/**
 * GitHub connector — interact with GitHub API for repos, PRs, issues.
 */
export class GitHubConnector implements Connector {
  readonly name = "github";
  readonly category = "vcs" as const;
  readonly description = "Interact with GitHub repositories, issues, and pull requests";

  private token: string;
  private baseUrl: string;

  constructor(token: string, baseUrl: string = "https://api.github.com") {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  listActions(): ConnectorAction[] {
    return [
      {
        name: "get_repo",
        description: "Get repository information",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
          },
          required: ["owner", "repo"],
        },
        riskLevel: "safe",
      },
      {
        name: "list_issues",
        description: "List issues in a repository",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
            state: { type: "string", enum: ["open", "closed", "all"] },
            limit: { type: "number" },
          },
          required: ["owner", "repo"],
        },
        riskLevel: "safe",
      },
      {
        name: "create_issue",
        description: "Create a new issue",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            labels: { type: "array", items: { type: "string" } },
          },
          required: ["owner", "repo", "title"],
        },
        riskLevel: "moderate",
      },
      {
        name: "create_pr",
        description: "Create a pull request",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            head: { type: "string" },
            base: { type: "string" },
          },
          required: ["owner", "repo", "title", "head", "base"],
        },
        riskLevel: "moderate",
      },
      {
        name: "get_file",
        description: "Get file contents from a repository",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
            path: { type: "string" },
            ref: { type: "string" },
          },
          required: ["owner", "repo", "path"],
        },
        riskLevel: "safe",
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
    switch (action) {
      case "get_repo":
        return this.apiGet(`/repos/${args["owner"]}/${args["repo"]}`);
      case "list_issues": {
        const limit = (args["limit"] as number) || 10;
        const state = (args["state"] as string) || "open";
        return this.apiGet(
          `/repos/${args["owner"]}/${args["repo"]}/issues?state=${state}&per_page=${limit}`,
        );
      }
      case "create_issue":
        return this.apiPost(`/repos/${args["owner"]}/${args["repo"]}/issues`, {
          title: args["title"],
          body: args["body"],
          labels: args["labels"],
        });
      case "create_pr":
        return this.apiPost(`/repos/${args["owner"]}/${args["repo"]}/pulls`, {
          title: args["title"],
          body: args["body"],
          head: args["head"],
          base: args["base"],
        });
      case "get_file":
        return this.apiGet(
          `/repos/${args["owner"]}/${args["repo"]}/contents/${args["path"]}${args["ref"] ? `?ref=${args["ref"]}` : ""}`,
        );
      default:
        return err(createError("connector", `Unknown GitHub action: ${action}`));
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.token.length > 0;
  }

  private async apiGet(path: string): Promise<Result<unknown>> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: this.headers(),
      });
      if (!res.ok) {
        return err(createError("connector", `GitHub API error: ${res.status} ${await res.text()}`));
      }
      return ok(await res.json());
    } catch (cause) {
      return err(createError("connector", "GitHub API request failed", { cause, retryable: true }));
    }
  }

  private async apiPost(path: string, body: unknown): Promise<Result<unknown>> {
    try {
      log.info("GitHub API POST", { path });
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return err(createError("connector", `GitHub API error: ${res.status} ${await res.text()}`));
      }
      return ok(await res.json());
    } catch (cause) {
      return err(createError("connector", "GitHub API request failed", { cause, retryable: true }));
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    };
  }
}
