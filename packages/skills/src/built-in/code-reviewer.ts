import type { Result, SkillManifest, SkillResult } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

/**
 * Code reviewer — reads a file (or files) and returns an actionable review
 * covering correctness, readability, performance, and security.
 */
export class CodeReviewerSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "code-reviewer",
    description: "Review one or more source files and report bugs, smells, and improvements.",
    version: "1.0.0",
    tags: ["review", "code", "quality", "security", "bug"],
    requiredConnectors: ["fs"],
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "List of file paths to review.",
        },
        focus: {
          type: "string",
          description: "Optional focus area (e.g., 'security', 'performance', 'readability').",
        },
      },
      required: ["paths"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    const paths = (params.paths as string[]) || [];
    const focus = (params.focus as string) || "general correctness, readability, performance, and security";
    if (paths.length === 0) return err(createError("validation", "code-reviewer needs at least one path"));

    const bundles: string[] = [];
    for (const p of paths.slice(0, 10)) {
      const read = await ctx.runConnector("fs.read", { path: p });
      if (!read.ok) {
        bundles.push(`### ${p}\n(unable to read: ${read.error.message})`);
        continue;
      }
      const content = String(read.value).slice(0, 6000);
      bundles.push(`### ${p}\n\`\`\`\n${content}\n\`\`\``);
    }

    const prompt = `You are a senior staff engineer doing a code review.
Focus: ${focus}.

For each file below, return a short review with sections:
  - Bugs (if any, with line refs)
  - Smells / readability notes
  - Security concerns
  - Concrete suggested changes

Only flag things that matter. No filler.

${bundles.join("\n\n")}`;

    const review = await ctx.complete(prompt, { temperature: 0.2 });
    if (!review.ok) return review as Result<never>;

    return ok({
      success: true,
      output: { paths, review: review.value },
      summary: review.value,
    });
  }
}
