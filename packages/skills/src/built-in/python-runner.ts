import { type Result, type SkillManifest, type SkillResult, ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export class PythonRunnerSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "python-runner",
    description: "Write and execute Python code in a temporary sandbox to perform complex computations or data manipulation.",
    version: "1.0.0",
    tags: ["python", "script", "execution", "computation", "data"],
    requiredConnectors: ["terminal"],
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The raw python code to execute.",
        },
        requirements: {
          type: "array",
          items: { type: "string" },
          description: "Optional pip dependencies to install before running.",
        },
      },
      required: ["code"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    const code = params.code as string;
    const requirements = (params.requirements || []) as string[];

    const sandboxId = randomUUID();
    const sandboxDir = path.join(os.tmpdir(), "splash-sandbox", sandboxId);
    
    try {
      await fs.mkdir(sandboxDir, { recursive: true });
      const scriptPath = path.join(sandboxDir, "script.py");
      await fs.writeFile(scriptPath, code, "utf-8");

      ctx.log(`Created Python sandbox at ${sandboxDir}`);

      // If requirements exist, try installing them
      if (requirements.length > 0) {
        ctx.log(`Installing Python dependencies: ${requirements.join(", ")}`);
        const installResult = await ctx.runConnector("terminal.run", {
          command: `python -m pip install ${requirements.join(" ")}`,
        });
        
        if (!installResult.ok) {
           return err(createError("skill", `Failed to install dependencies: ${installResult.error.message}`));
        }
      }

      ctx.log("Executing Python script");
      const result = await ctx.runConnector("terminal.run", {
        command: `python "${scriptPath}"`,
      });

      if (!result.ok) {
        return err(createError("skill", `Python execution failed: ${result.error.message}`));
      }

      const output = (result.value as any)?.stdout || String(result.value);
      
      return ok({
        success: true,
        output: output.trim() || "Script executed successfully with no standard output.",
        summary: `Successfully executed Python script${requirements.length > 0 ? " with dependencies." : "."}`,
      });
    } catch (e) {
      return err(createError("skill", String(e)));
    } finally {
      // Teardown sandbox safely
      try {
         await fs.rm(sandboxDir, { recursive: true, force: true });
         ctx.log(`Cleaned up Python sandbox at ${sandboxDir}`);
      } catch (cleanupError) {
         ctx.log(`Failed to cleanup sandbox: ${cleanupError}`);
      }
    }
  }
}
