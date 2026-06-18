import type { SkillManifest, SkillResult, Result } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

export class DeployerSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "deployer",
    description: "Deploy a project by running build, lint, test, and deploy commands in sequence",
    version: "1.0.0",
    tags: ["deploy", "deployment", "build", "ci", "cd", "release"],
    requiredConnectors: ["terminal"],
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Project root directory" },
        buildCommand: { type: "string", description: "Build command (default: auto-detect)" },
        testCommand: { type: "string", description: "Test command (default: auto-detect)" },
        deployCommand: { type: "string", description: "Deploy command (required)" },
        skipTests: { type: "boolean", description: "Skip tests before deploying" },
        dryRun: { type: "boolean", description: "Run all steps except the actual deploy" },
      },
      required: ["cwd", "deployCommand"],
    },
  };

  async execute(
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<Result<SkillResult>> {
    const cwd = params["cwd"] as string;
    const deployCommand = params["deployCommand"] as string;
    const skipTests = (params["skipTests"] as boolean) || false;
    const dryRun = (params["dryRun"] as boolean) || false;

    if (!deployCommand) return err(createError("skill", "deployCommand is required"));

    ctx.log("Starting deployment pipeline", { cwd, dryRun });

    const results: { step: string; success: boolean; output: string }[] = [];

    // Step 1: Build
    const buildCmd = (params["buildCommand"] as string) || await this.detectBuildCommand(cwd, ctx);
    ctx.log("Running build", { command: buildCmd });
    const buildResult = await this.runStep(ctx, "build", buildCmd, cwd);
    results.push(buildResult);

    if (!buildResult.success) {
      return ok({
        success: false,
        output: results,
        summary: `Deployment aborted: build failed. ${buildResult.output.slice(0, 200)}`,
      });
    }

    // Step 2: Tests (unless skipped)
    if (!skipTests) {
      const testCmd = (params["testCommand"] as string) || "npm test";
      ctx.log("Running tests", { command: testCmd });
      const testResult = await this.runStep(ctx, "test", testCmd, cwd);
      results.push(testResult);

      if (!testResult.success) {
        return ok({
          success: false,
          output: results,
          summary: `Deployment aborted: tests failed. ${testResult.output.slice(0, 200)}`,
        });
      }
    }

    // Step 3: Deploy (or dry-run)
    if (dryRun) {
      ctx.log("Dry run — skipping actual deploy");
      results.push({ step: "deploy", success: true, output: "DRY RUN — skipped" });
    } else {
      ctx.log("Deploying", { command: deployCommand });
      const deployResult = await this.runStep(ctx, "deploy", deployCommand, cwd);
      results.push(deployResult);

      if (!deployResult.success) {
        return ok({
          success: false,
          output: results,
          summary: `Deployment failed: ${deployResult.output.slice(0, 200)}`,
          sideEffects: ["Deploy command was executed but failed"],
        });
      }
    }

    return ok({
      success: true,
      output: results,
      summary: dryRun
        ? `Dry run complete: build and tests passed`
        : `Deployment successful (${results.length} steps completed)`,
      sideEffects: dryRun ? [] : [`Deployed via: ${deployCommand}`],
    });
  }

  private async runStep(
    ctx: SkillContext,
    name: string,
    command: string,
    cwd: string,
  ): Promise<{ step: string; success: boolean; output: string }> {
    const result = await ctx.runConnector("terminal.run", { command, cwd, timeout: 120000 });
    if (!result.ok) {
      return { step: name, success: false, output: result.error.message };
    }
    const out = result.value as { stdout: string; stderr: string; exitCode: number };
    return {
      step: name,
      success: out.exitCode === 0,
      output: (out.stdout + out.stderr).slice(-1000),
    };
  }

  private async detectBuildCommand(cwd: string, ctx: SkillContext): Promise<string> {
    const pkgResult = await ctx.runConnector("fs.read", { path: `${cwd}/package.json` });
    if (pkgResult.ok) {
      try {
        const pkg = JSON.parse(pkgResult.value as string);
        if (pkg.scripts?.build) return "npm run build";
      } catch { /* ignore */ }
    }
    return "echo 'No build command detected'";
  }
}
