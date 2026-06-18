import { type Result, type SkillManifest, type SkillResult, ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export class ShellRunnerSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "shell-runner",
    description: "Write and execute arbitrary Shell or Bash scripts safely within a constrained environment.",
    version: "1.0.0",
    tags: ["shell", "bash", "script", "execution", "terminal", "os"],
    requiredConnectors: ["terminal"],
    parameters: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "The raw shell script content to execute.",
        },
        usePowerShell: {
          type: "boolean",
          description: "If true, run as a PowerShell (.ps1) script on Windows.",
        },
      },
      required: ["script"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    const scriptContent = params.script as string;
    const usePowerShell = params.usePowerShell === true;

    const sandboxId = randomUUID();
    const sandboxDir = path.join(os.tmpdir(), "splash-sandbox", sandboxId);
    
    // Determine extension based on OS and parameters
    const isWindows = os.platform() === "win32";
    let ext = ".sh";
    let runnerExecutable = "bash";

    if (isWindows) {
      if (usePowerShell) {
        ext = ".ps1";
        runnerExecutable = "powershell -ExecutionPolicy Bypass -File";
      } else {
        ext = ".bat";
        runnerExecutable = "cmd.exe /c";
      }
    } else if (usePowerShell) {
      // Allow overriding on Mac/Linux if ps is somehow installed
      ext = ".ps1";
      runnerExecutable = "pwsh -File";
    }

    try {
      await fs.mkdir(sandboxDir, { recursive: true });
      const scriptPath = path.join(sandboxDir, `script${ext}`);
      
      // normalize line endings depending on system
      const normalizedScript = isWindows && ext === ".bat" 
        ? scriptContent.replace(/\n/g, "\r\n") 
        : scriptContent;

      await fs.writeFile(scriptPath, normalizedScript, "utf-8");

      // Set executable permission for unixes
      if (!isWindows) {
        await fs.chmod(scriptPath, 0o755);
      }

      ctx.log(`Created Shell sandbox script at ${scriptPath}`);

      const result = await ctx.runConnector("terminal.run", {
        command: `${runnerExecutable} "${scriptPath}"`,
      });

      if (!result.ok) {
        return err(createError("skill", `Shell script execution failed: ${result.error.message}`));
      }

      const output = (result.value as any)?.stdout || String(result.value);
      
      return ok({
        success: true,
        output: output.trim() || "Script executed successfully with no standard output.",
        summary: "Successfully executed Shell script.",
      });
    } catch (e) {
      return err(createError("skill", String(e)));
    } finally {
      // Teardown sandbox safely
      try {
         await fs.rm(sandboxDir, { recursive: true, force: true });
         ctx.log(`Cleaned up Shell sandbox at ${sandboxDir}`);
      } catch (cleanupError) {
         ctx.log(`Failed to cleanup sandbox: ${cleanupError}`);
      }
    }
  }
}
