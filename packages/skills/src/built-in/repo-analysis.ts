import type { SkillManifest, SkillResult, Result } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

export class RepoAnalysisSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "repo-analysis",
    description: "Analyze a repository structure, tech stack, and key files",
    version: "1.0.0",
    tags: ["analysis", "repo", "codebase"],
    requiredConnectors: ["fs", "terminal"],
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Root path of the repository" },
      },
      required: ["path"],
    },
  };

  async execute(
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<Result<SkillResult>> {
    const path = params["path"] as string;
    if (!path) return err(createError("skill", "path is required"));

    ctx.log("Analyzing repository", { path });

    // List top-level files
    const filesResult = await ctx.runConnector("fs.list", { path });
    if (!filesResult.ok) return filesResult as Result<never>;
    const files = filesResult.value as string[];

    // Check for key files
    const keyFiles = [
      "package.json",
      "tsconfig.json",
      "Cargo.toml",
      "go.mod",
      "pyproject.toml",
      "Makefile",
      "Dockerfile",
      ".gitignore",
      "README.md",
    ];

    const found: string[] = [];
    for (const kf of keyFiles) {
      const exists = await ctx.runConnector("fs.exists", { path: `${path}/${kf}` });
      if (exists.ok && exists.value === true) found.push(kf);
    }

    // Try to read package.json for tech stack info
    let techStack = "unknown";
    let projectName = "unknown";

    if (found.includes("package.json")) {
      const pkgResult = await ctx.runConnector("fs.read", { path: `${path}/package.json` });
      if (pkgResult.ok) {
        try {
          const pkg = JSON.parse(pkgResult.value as string);
          projectName = pkg.name || "unknown";
          const deps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
          };
          const depsKeys = Object.keys(deps || {});
          techStack = depsKeys.slice(0, 15).join(", ");
        } catch {
          // ignore parse errors
        }
      }
    }

    // Get git info
    let gitBranch = "unknown";
    let recentCommits = "";
    const branchResult = await ctx.runConnector("terminal.run", {
      command: "git branch --show-current",
      cwd: path,
    });
    if (branchResult.ok) {
      const brOut = branchResult.value as { stdout: string };
      gitBranch = brOut.stdout.trim();
    }

    const logResult = await ctx.runConnector("terminal.run", {
      command: 'git log --oneline -5 2>/dev/null || echo "no git history"',
      cwd: path,
    });
    if (logResult.ok) {
      const logOut = logResult.value as { stdout: string };
      recentCommits = logOut.stdout.trim();
    }

    const summary = [
      `Project: ${projectName}`,
      `Path: ${path}`,
      `Branch: ${gitBranch}`,
      `Key files: ${found.join(", ")}`,
      `Tech stack: ${techStack}`,
      `Total entries: ${files.length}`,
      `Recent commits:\n${recentCommits}`,
    ].join("\n");

    return ok({
      success: true,
      output: {
        projectName,
        path,
        gitBranch,
        keyFiles: found,
        techStack,
        fileCount: files.length,
        recentCommits,
      },
      summary,
    });
  }
}
