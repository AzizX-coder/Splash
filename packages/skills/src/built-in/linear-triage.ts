import { type Result, type SkillManifest, type SkillResult, ok, err, createError } from "@alpclaw/utils";
import type { Skill, SkillContext } from "../skill.js";

export class LinearTriageSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "linear-triage",
    description: "Create, read, or update Linear issues using the Linear GraphQL API.",
    version: "1.0.0",
    tags: ["linear", "issue", "ticket", "triage", "tracker"],
    requiredConnectors: [],
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["createIssue", "listIssues"], description: "The action to perform." },
        teamId: { type: "string", description: "Linear Team ID (required for createIssue)." },
        title: { type: "string", description: "Issue title." },
        description: { type: "string", description: "Issue description." },
        linearApiKey: { type: "string", description: "Linear API Key (if not provided in env LINEAR_API_KEY)." }
      },
      required: ["action"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    const action = String(params.action || "");
    const apiKey = String(params.linearApiKey || process.env.LINEAR_API_KEY || "");
    
    if (!apiKey) return err(createError("validation", "Missing Linear API key"));

    const endpoint = "https://api.linear.app/graphql";
    const headers = {
      "Authorization": apiKey,
      "Content-Type": "application/json",
    };

    try {
      if (action === "createIssue") {
        const teamId = String(params.teamId || "");
        if (!teamId) return err(createError("validation", "teamId is required for createIssue"));
        
        const query = `
          mutation IssueCreate($title: String!, $description: String, $teamId: String!) {
            issueCreate(input: {title: $title, description: $description, teamId: $teamId}) {
              success
              issue {
                id
                identifier
                url
              }
            }
          }
        `;
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            query,
            variables: {
              title: params.title || "New Issue",
              description: params.description || "",
              teamId
            }
          })
        });
        
        if (!res.ok) return err(createError("skill", `Linear API error: ${res.status}`));
        const data = await res.json();
        return ok({
          success: true,
          output: data,
          summary: `Created Linear issue: ${data?.data?.issueCreate?.issue?.identifier}`
        });

      } else if (action === "listIssues") {
        const query = `
          query {
            issues(first: 10, filter: { state: { name: { eq: "Triage" } } }) {
              nodes {
                id
                identifier
                title
                url
              }
            }
          }
        `;
        const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ query }) });
        if (!res.ok) return err(createError("skill", `Linear API error: ${res.status}`));
        const data = await res.json();
        return ok({
          success: true,
          output: data,
          summary: `Fetched ${data?.data?.issues?.nodes?.length || 0} issues from Triage.`
        });
      }

      return err(createError("validation", `Unknown action: ${action}`));
    } catch (e: any) {
      return err(createError("skill", String(e.message || e)));
    }
  }
}
