import type { SkillManifest, SkillResult, Result } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

export class TaskSummarizerSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "task-summarizer",
    description: "Summarize task results, execution logs, or documents using the LLM",
    version: "1.0.0",
    tags: ["summarize", "summary", "report", "docs"],
    requiredConnectors: [],
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to summarize" },
        style: {
          type: "string",
          enum: ["brief", "detailed", "bullet-points"],
          description: "Summary style",
        },
        maxLength: { type: "number", description: "Max summary length in chars" },
      },
      required: ["content"],
    },
  };

  async execute(
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<Result<SkillResult>> {
    const content = params["content"] as string;
    const style = (params["style"] as string) || "brief";
    const maxLength = (params["maxLength"] as number) || 500;

    if (!content) return err(createError("skill", "content is required"));

    ctx.log("Summarizing content", { style, contentLength: content.length });

    const prompt = `Summarize the following content in a ${style} style. Keep it under ${maxLength} characters.\n\n${content}`;

    const result = await ctx.complete(prompt, { temperature: 0.3 });
    if (!result.ok) return result as Result<never>;

    return ok({
      success: true,
      output: { summary: result.value, style, originalLength: content.length },
      summary: result.value,
    });
  }
}
