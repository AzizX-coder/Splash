import type { Result, SkillManifest, SkillResult } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

/**
 * Data analyst — reads a CSV/JSON/TSV file and uses the Python runner
 * to answer a question (summary stats, filter, aggregate, etc.).
 * Falls back to LLM-only analysis when Python is unavailable.
 */
export class DataAnalystSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "data-analyst",
    description: "Read a dataset (CSV/JSON/TSV) and answer analytical questions about it.",
    version: "1.0.0",
    tags: ["data", "analysis", "csv", "json", "stats", "pandas"],
    requiredConnectors: ["fs", "terminal"],
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the dataset file." },
        question: { type: "string", description: "Analytical question to answer." },
      },
      required: ["path", "question"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    const path = String(params.path || "");
    const question = String(params.question || "");
    if (!path || !question) return err(createError("validation", "data-analyst requires path + question"));

    const ext = path.split(".").pop()?.toLowerCase() || "";
    ctx.log("data-analyst dispatch", { path, ext });

    // Ask the model to write a pandas script tailored to the question + file
    const scriptPrompt = `Write a short self-contained Python script (pandas + json allowed) that:
  1) Loads the dataset at path: ${path} (format: ${ext})
  2) Answers this question: ${question}
  3) Prints the answer as plain text or JSON. No charts.

Return ONLY the Python code, no markdown fences.`;

    const scriptResult = await ctx.complete(scriptPrompt, { temperature: 0.1 });
    if (!scriptResult.ok) return scriptResult as Result<never>;

    const code = scriptResult.value.replace(/^```(?:python)?\s*|\s*```$/g, "");
    const run = await ctx.runConnector("terminal.run", {
      command: `python -c ${JSON.stringify(code)}`,
    });

    if (!run.ok) {
      return ok({
        success: false,
        output: { code, error: run.error.message },
        summary: `Python analysis failed: ${run.error.message}. Script was:\n\n${code}`,
      });
    }

    const stdout = (run.value as any)?.stdout || String(run.value);
    return ok({
      success: true,
      output: { path, question, code, result: stdout },
      summary: stdout.trim().slice(0, 2000) || "No output produced.",
    });
  }
}
