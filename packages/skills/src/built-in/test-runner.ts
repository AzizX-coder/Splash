import type { SkillManifest, SkillResult, Result } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

export class TestRunnerSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "test-runner",
    description: "Run project tests and report results",
    version: "1.0.0",
    tags: ["test", "testing", "verify", "quality"],
    requiredConnectors: ["terminal"],
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Project root directory" },
        command: { type: "string", description: "Custom test command (optional)" },
        filter: { type: "string", description: "Test name filter (optional)" },
      },
      required: ["cwd"],
    },
  };

  async execute(
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<Result<SkillResult>> {
    const cwd = params["cwd"] as string;
    const filter = params["filter"] as string | undefined;

    ctx.log("Running tests", { cwd, filter });

    // Detect test framework
    let testCommand = params["command"] as string | undefined;
    if (!testCommand) {
      testCommand = await this.detectTestCommand(cwd, ctx);
    }

    if (filter) {
      testCommand += ` -- --grep "${filter}"`;
    }

    const result = await ctx.runConnector("terminal.run", {
      command: testCommand,
      cwd,
      timeout: 120000, // 2 minutes
    });

    if (!result.ok) {
      return ok({
        success: false,
        output: { error: result.error },
        summary: `Tests failed to execute: ${result.error.message}`,
      });
    }

    const output = result.value as { stdout: string; stderr: string; exitCode: number };
    const passed = output.exitCode === 0;

    return ok({
      success: passed,
      output: {
        exitCode: output.exitCode,
        stdout: output.stdout.slice(-2000), // Last 2000 chars
        stderr: output.stderr.slice(-1000),
      },
      summary: passed
        ? `Tests passed successfully`
        : `Tests failed (exit code ${output.exitCode}). Check output for details.`,
    });
  }

  private async detectTestCommand(cwd: string, ctx: SkillContext): Promise<string> {
    // Check for common test configs
    const pkgResult = await ctx.runConnector("fs.read", { path: `${cwd}/package.json` });
    if (pkgResult.ok) {
      try {
        const pkg = JSON.parse(pkgResult.value as string);
        if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
          // Detect package manager
          const hasYarnLock = await ctx.runConnector("fs.exists", { path: `${cwd}/yarn.lock` });
          const hasPnpmLock = await ctx.runConnector("fs.exists", { path: `${cwd}/pnpm-lock.yaml` });

          if (hasPnpmLock.ok && hasPnpmLock.value) return "pnpm test";
          if (hasYarnLock.ok && hasYarnLock.value) return "yarn test";
          return "npm test";
        }
      } catch {
        // ignore
      }
    }

    return "npm test";
  }
}
