import type { SkillManifest, SkillResult, Result } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

export class DebuggerSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "debugger",
    description: "Diagnose errors by analyzing error messages, stack traces, and related code",
    version: "1.0.0",
    tags: ["debug", "error", "diagnose", "fix", "troubleshoot"],
    requiredConnectors: ["fs"],
    parameters: {
      type: "object",
      properties: {
        error: { type: "string", description: "Error message or stack trace" },
        filePath: { type: "string", description: "File where the error occurred (optional)" },
        cwd: { type: "string", description: "Project root (optional)" },
      },
      required: ["error"],
    },
  };

  async execute(
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<Result<SkillResult>> {
    const errorMsg = params["error"] as string;
    const filePath = params["filePath"] as string | undefined;

    ctx.log("Debugging error", { errorLength: errorMsg.length, filePath });

    // Build context for the LLM
    let codeContext = "";
    if (filePath) {
      const readResult = await ctx.runConnector("fs.read", { path: filePath });
      if (readResult.ok) {
        codeContext = `\n\nRelevant file (${filePath}):\n\`\`\`\n${(readResult.value as string).slice(0, 3000)}\n\`\`\``;
      }
    }

    const prompt = `You are a senior debugger. Analyze this error and provide:
1. Root cause analysis
2. Suggested fix
3. Prevention advice

Error:
${errorMsg}
${codeContext}

Respond concisely and practically.`;

    const result = await ctx.complete(prompt, { temperature: 0.2 });
    if (!result.ok) return result as Result<never>;

    return ok({
      success: true,
      output: { diagnosis: result.value, error: errorMsg, filePath },
      summary: result.value,
    });
  }
}
