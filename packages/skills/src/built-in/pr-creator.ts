import type { SkillManifest, SkillResult, Result } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

export class PrCreatorSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "pr-creator",
    description: "Create a pull request on GitHub with auto-generated title and description",
    version: "1.0.0",
    tags: ["pr", "pull-request", "github", "vcs", "git"],
    requiredConnectors: ["terminal", "github"],
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Repository root directory" },
        owner: { type: "string", description: "GitHub repo owner" },
        repo: { type: "string", description: "GitHub repo name" },
        base: { type: "string", description: "Base branch (default: main)" },
        title: { type: "string", description: "PR title (auto-generated if omitted)" },
        body: { type: "string", description: "PR body (auto-generated if omitted)" },
      },
      required: ["cwd", "owner", "repo"],
    },
  };

  async execute(
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<Result<SkillResult>> {
    const cwd = params["cwd"] as string;
    const owner = params["owner"] as string;
    const repo = params["repo"] as string;
    const base = (params["base"] as string) || "main";

    ctx.log("Creating pull request", { owner, repo, base });

    // Get current branch
    const branchResult = await ctx.runConnector("terminal.run", {
      command: "git branch --show-current",
      cwd,
    });
    if (!branchResult.ok) return branchResult as Result<never>;
    const head = (branchResult.value as { stdout: string }).stdout.trim();

    if (head === base) {
      return ok({
        success: false,
        output: null,
        summary: `Cannot create PR: currently on ${base} branch`,
      });
    }

    // Get diff summary for auto-generated description
    const diffResult = await ctx.runConnector("terminal.run", {
      command: `git log ${base}..${head} --oneline`,
      cwd,
    });

    const commits = diffResult.ok
      ? (diffResult.value as { stdout: string }).stdout.trim()
      : "No commit info available";

    // Auto-generate title & body if not provided
    let title = params["title"] as string | undefined;
    let body = params["body"] as string | undefined;

    if (!title || !body) {
      const prompt = `Generate a concise PR title and description for these commits:\n${commits}\n\nBranch: ${head} → ${base}\n\nRespond with JSON: { "title": "...", "body": "..." }`;
      const llmResult = await ctx.complete(prompt, { temperature: 0.3 });

      if (llmResult.ok) {
        try {
          const parsed = JSON.parse(
            llmResult.value.match(/\{[\s\S]*\}/)?.[0] || "{}",
          );
          title = title || parsed.title || `Merge ${head}`;
          body = body || parsed.body || commits;
        } catch {
          title = title || `Merge ${head}`;
          body = body || commits;
        }
      } else {
        title = title || `Merge ${head}`;
        body = body || commits;
      }
    }

    // Create the PR
    const prResult = await ctx.runConnector("github.create_pr", {
      owner,
      repo,
      title,
      body,
      head,
      base,
    });

    if (!prResult.ok) return prResult as Result<never>;

    return ok({
      success: true,
      output: prResult.value,
      summary: `Created PR: "${title}" (${head} → ${base})`,
      sideEffects: [`Created pull request on ${owner}/${repo}`],
    });
  }
}
