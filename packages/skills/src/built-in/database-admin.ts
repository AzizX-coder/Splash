import { type Result, type SkillManifest, type SkillResult, ok, err, createError } from "@alpclaw/utils";
import type { Skill, SkillContext } from "../skill.js";

export class DatabaseAdminSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "database-admin",
    description: "Inspect local SQLite databases or Postgres configurations",
    version: "1.0.0",
    tags: ["database", "sql", "sqlite", "query", "admin", "optimized"],
    requiredConnectors: ["database"],
    parameters: {
      type: "object",
      properties: {
        database_path: {
          type: "string",
          description: "Path to the sqlite database file",
        },
        query: {
          type: "string",
          description: "The SQL query to execute safely (READ ONLY)",
        },
      },
      required: ["database_path", "query"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    try {
      const dbPath = params.database_path as string;
      const query = params.query as string;

      if (!query.trim().toLowerCase().startsWith("select") && !query.trim().toLowerCase().startsWith(".table") && !query.trim().toLowerCase().startsWith(".schema")) {
        return err(createError("skill", "Security violation: Only SELECT, .tables, or .schema queries are permitted by the db-admin skill."));
      }
      if (query.includes(";")) {
        return err(createError("skill", "Security violation: Multiple statements separated by semicolons are not permitted."));
      }

      ctx.log(`Executing optimized SQL on ${dbPath}`);
      
      const result = await ctx.runConnector("database.query", {
        databasePath: dbPath,
        query,
        readonly: true,
      });

      if (!result.ok) {
        return err(createError("skill", `SQL execution failed: ${result.error.message}`));
      }

      const output = JSON.stringify(result.value, null, 2);

      return ok({
        success: true,
        output: output !== "{\n  \"rows\": []\n}" ? output : "Query returned 0 rows.",
        summary: `Executed optimized database query on ${dbPath}.`,
      });
    } catch (e) {
      return err(createError("skill", String(e)));
    }
  }
}
