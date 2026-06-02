import { type Result, type SkillManifest, type SkillResult, ok, err, createError } from "@alpclaw/utils";
import type { Skill, SkillContext } from "../skill.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export class GitHelperSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "git-helper",
    description: "Execute git commands like clone, commit, push, pull, status securely.",
    version: "1.0.0",
    tags: ["git", "version-control", "vcs", "repo"],
    requiredConnectors: [],
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The full git command to run (e.g. \"git status\")" },
        cwd: { type: "string", description: "Optional working directory" },
      },
      required: ["command"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    const cmd = String(params.command || "");
    const cwd = params.cwd ? String(params.cwd) : process.cwd();

    if (!cmd.trim().startsWith("git ")) {
      return err(createError("validation", "Only git commands are allowed"));
    }

    try {
      ctx.log(`Running git command: ${cmd} in ${cwd}`);
      const { stdout, stderr } = await execAsync(cmd, { cwd });
      return ok({
        success: true,
        output: stdout || stderr,
        summary: `Successfully executed ${cmd}`,
      });
    } catch (e: any) {
      return err(createError("skill", String(e.message || e)));
    }
  }
}
