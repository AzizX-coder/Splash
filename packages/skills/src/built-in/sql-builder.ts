import type { Result, SkillManifest, SkillResult } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

/**
 * SQL builder — given a natural-language question and optional schema,
 * produces a safe read-only SQL query. Can optionally execute it via
 * the `database.query` connector action.
 */
export class SqlBuilderSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "sql-builder",
    description: "Translate a natural-language question into a SQL query and optionally run it.",
    version: "1.0.0",
    tags: ["sql", "query", "database", "sqlite"],
    requiredConnectors: ["database"],
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The analytical question in plain English." },
        schema: { type: "string", description: "Optional DDL or schema description." },
        databasePath: { type: "string", description: "If provided, execute the query against this SQLite file." },
        dryRun: { type: "boolean", description: "If true, do not execute — only return the SQL." },
      },
      required: ["question"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    const question = String(params.question || "");
    const schema = (params.schema as string) || "(no schema provided)";
    const databasePath = params.databasePath as string | undefined;
    const dryRun = params.dryRun === true;

    if (!question) return err(createError("validation", "sql-builder requires a question"));

    const prompt = `You are a SQL assistant. Produce a single, read-only SQL SELECT (or WITH) that answers the question.
Reject requests that would mutate data. Use standard SQLite syntax.

Schema:
${schema}

Question: ${question}

Return only the SQL, no commentary, no markdown fences.`;

    const sqlResult = await ctx.complete(prompt, { temperature: 0 });
    if (!sqlResult.ok) return sqlResult as Result<never>;

    const sql = sqlResult.value.replace(/^```(?:sql)?\s*|\s*```$/g, "").trim();
    const lower = sql.toLowerCase();
    if (/(insert|update|delete|drop|alter|truncate|attach)\s/.test(lower)) {
      return err(createError("safety", "Generated SQL contained write operations — refusing."));
    }

    if (dryRun || !databasePath) {
      return ok({
        success: true,
        output: { question, sql },
        summary: `Generated SQL:\n\n${sql}`,
      });
    }

    const run = await ctx.runConnector("database.query", {
      databasePath,
      query: sql,
      readonly: true,
    });
    if (!run.ok) return err(run.error);

    return ok({
      success: true,
      output: { question, sql, rows: (run.value as any)?.rows },
      summary: `Executed SQL:\n${sql}\n\nRows: ${JSON.stringify((run.value as any)?.rows).slice(0, 1000)}`,
    });
  }
}
