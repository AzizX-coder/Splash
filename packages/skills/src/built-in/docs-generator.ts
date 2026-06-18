import type { SkillManifest, SkillResult, Result } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

export class DocsGeneratorSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "docs-generator",
    description: "Generate documentation (README, API docs, guides) from source code",
    version: "1.0.0",
    tags: ["docs", "documentation", "readme", "api", "generate"],
    requiredConnectors: ["fs"],
    parameters: {
      type: "object",
      properties: {
        sourcePaths: {
          type: "array",
          items: { type: "string" },
          description: "Source file paths to document",
        },
        outputPath: { type: "string", description: "Where to write the generated docs" },
        style: {
          type: "string",
          enum: ["readme", "api", "tutorial", "changelog"],
          description: "Documentation style",
        },
        projectName: { type: "string", description: "Project name for headers" },
      },
      required: ["sourcePaths", "outputPath"],
    },
  };

  async execute(
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<Result<SkillResult>> {
    const sourcePaths = params["sourcePaths"] as string[];
    const outputPath = params["outputPath"] as string;
    const docStyle = (params["style"] as string) || "readme";
    const projectName = (params["projectName"] as string) || "Project";

    if (!sourcePaths || sourcePaths.length === 0) {
      return err(createError("skill", "sourcePaths is required"));
    }

    ctx.log("Generating docs", { style: docStyle, sources: sourcePaths.length });

    // Read source files
    const sources: string[] = [];
    for (const sp of sourcePaths.slice(0, 10)) {
      const readResult = await ctx.runConnector("fs.read", { path: sp });
      if (readResult.ok) {
        sources.push(`--- File: ${sp} ---\n${(readResult.value as string).slice(0, 5000)}`);
      }
    }

    if (sources.length === 0) {
      return ok({
        success: false,
        output: null,
        summary: "No source files could be read",
      });
    }

    const styleGuides: Record<string, string> = {
      readme:
        "Generate a professional README.md with sections: Overview, Installation, Usage, API, Examples, License.",
      api: "Generate API reference documentation with function signatures, parameters, return types, and examples.",
      tutorial:
        "Generate a step-by-step tutorial that walks through the main features with code examples.",
      changelog:
        "Generate a CHANGELOG entry listing new features, fixes, and breaking changes.",
    };

    const prompt = `You are a technical writer. ${styleGuides[docStyle] || styleGuides["readme"]}

Project: ${projectName}

Source code:
${sources.join("\n\n")}

Generate clean, professional markdown documentation. Include code examples where helpful.`;

    const result = await ctx.complete(prompt, { temperature: 0.4 });
    if (!result.ok) return result as Result<never>;

    // Write the docs
    const writeResult = await ctx.runConnector("fs.write", {
      path: outputPath,
      content: result.value,
    });
    if (!writeResult.ok) return writeResult as Result<never>;

    return ok({
      success: true,
      output: { outputPath, style: docStyle, sourceCount: sources.length },
      summary: `Generated ${docStyle} documentation at ${outputPath}`,
      sideEffects: [`Created file: ${outputPath}`],
    });
  }
}
