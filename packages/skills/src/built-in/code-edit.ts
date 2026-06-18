import type { SkillManifest, SkillResult, Result } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

export class CodeEditSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "code-edit",
    description: "Edit code files using search-and-replace or full rewrite",
    version: "1.0.0",
    tags: ["code", "edit", "file", "programming"],
    requiredConnectors: ["fs"],
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to the file to edit" },
        operation: {
          type: "string",
          enum: ["replace", "insert", "rewrite"],
          description: "Type of edit operation",
        },
        search: { type: "string", description: "String to find (for replace)" },
        replacement: { type: "string", description: "Replacement string" },
        content: { type: "string", description: "Full content (for rewrite)" },
        line: { type: "number", description: "Line number (for insert)" },
      },
      required: ["filePath", "operation"],
    },
  };

  async execute(
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<Result<SkillResult>> {
    const filePath = params["filePath"] as string;
    const operation = params["operation"] as string;

    ctx.log("Code edit", { filePath, operation });

    switch (operation) {
      case "replace": {
        const search = params["search"] as string;
        const replacement = params["replacement"] as string;
        if (!search) return err(createError("skill", "search is required for replace"));

        const readResult = await ctx.runConnector("fs.read", { path: filePath });
        if (!readResult.ok) return readResult as Result<never>;

        const content = readResult.value as string;
        if (!content.includes(search)) {
          return ok({
            success: false,
            output: null,
            summary: `Search string not found in ${filePath}`,
          });
        }

        const newContent = content.replaceAll(search, replacement);
        const writeResult = await ctx.runConnector("fs.write", {
          path: filePath,
          content: newContent,
        });
        if (!writeResult.ok) return writeResult as Result<never>;

        return ok({
          success: true,
          output: { filePath, operation, linesChanged: 1 },
          summary: `Replaced text in ${filePath}`,
          sideEffects: [`Modified file: ${filePath}`],
        });
      }

      case "insert": {
        const line = params["line"] as number;
        const insertText = params["replacement"] as string || params["content"] as string;
        if (!insertText) return err(createError("skill", "content is required for insert"));

        const readResult = await ctx.runConnector("fs.read", { path: filePath });
        if (!readResult.ok) return readResult as Result<never>;

        const lines = (readResult.value as string).split("\n");
        const insertAt = Math.min(line || lines.length, lines.length);
        lines.splice(insertAt, 0, insertText);

        const writeResult = await ctx.runConnector("fs.write", {
          path: filePath,
          content: lines.join("\n"),
        });
        if (!writeResult.ok) return writeResult as Result<never>;

        return ok({
          success: true,
          output: { filePath, operation, insertedAt: insertAt },
          summary: `Inserted text at line ${insertAt} in ${filePath}`,
          sideEffects: [`Modified file: ${filePath}`],
        });
      }

      case "rewrite": {
        const content = params["content"] as string;
        if (!content) return err(createError("skill", "content is required for rewrite"));

        const writeResult = await ctx.runConnector("fs.write", {
          path: filePath,
          content,
        });
        if (!writeResult.ok) return writeResult as Result<never>;

        return ok({
          success: true,
          output: { filePath, operation },
          summary: `Rewrote file ${filePath}`,
          sideEffects: [`Rewrote file: ${filePath}`],
        });
      }

      default:
        return err(createError("skill", `Unknown code-edit operation: ${operation}`));
    }
  }
}
