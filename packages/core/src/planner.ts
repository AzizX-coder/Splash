import type { Message, Result } from "@alpclaw/utils";
import { ok, err, createError, createLogger } from "@alpclaw/utils";
import type { ProviderRouter } from "@alpclaw/providers";
import type { SkillManifest, ToolDefinition } from "@alpclaw/utils";

const log = createLogger("core:planner");

export interface Plan {
  steps: PlanStep[];
  reasoning: string;
  estimatedComplexity: "simple" | "moderate" | "complex";
}

export interface PlanStep {
  description: string;
  toolOrSkill?: string;
  dependsOn?: number[];
}

/**
 * Planner uses the LLM to break down tasks into executable steps.
 */
export class Planner {
  constructor(private router: ProviderRouter) {}

  async createPlan(
    taskDescription: string,
    availableTools: ToolDefinition[],
    availableSkills: SkillManifest[],
    contextHints: string[] = [],
  ): Promise<Result<Plan>> {
    const toolNames = availableTools.map((t) => `${t.name}: ${t.description}`).join("\n");
    const skillNames = availableSkills.map((s) => `${s.name}: ${s.description}`).join("\n");
    const context = contextHints.length > 0 ? `\nRelevant context:\n${contextHints.join("\n")}` : "";

    const systemPrompt = `You are a task planner for an autonomous agent. Break down the user's task into concrete, executable steps.

Available tools:
${toolNames}

Available skills:
${skillNames}
${context}

Respond with a JSON object matching this schema:
{
  "reasoning": "brief explanation of your approach",
  "estimatedComplexity": "simple" | "moderate" | "complex",
  "steps": [
    { "description": "what to do", "toolOrSkill": "name of tool/skill to use (optional)", "dependsOn": [step indices this depends on (optional)] }
  ]
}

Keep the plan practical and minimal. Only include steps that are necessary.`;

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: taskDescription },
    ];

    log.info("Creating plan", { taskDescription: taskDescription.slice(0, 100) });

    const strictSystemPrompt = `${systemPrompt}
CRITICAL: You must respond with ONLY a JSON object matching the schema above. Do not use markdown. Do not add explanation. Do not wrap in code blocks.`;

    let result = await this.router.route(
      { messages, temperature: 0.2, maxTokens: 2000 },
      { taskType: "reasoning" },
    );

    // Retry once with stricter prompt on failure or empty/invalid plan
    if (!result.ok) {
      log.warn("Planner first attempt failed, retrying with stricter prompt");
      result = await this.router.route(
        { messages: [{ role: "system", content: strictSystemPrompt }, { role: "user", content: taskDescription }], temperature: 0, maxTokens: 1000 },
        { taskType: "reasoning" },
      );
    }

    // Degraded fallback: never return err() from planner
    if (!result.ok) {
      const is429 = result.error?.message?.includes("429") || result.error?.message?.includes("rate-limit");
      const fallback: Plan = {
        reasoning: is429
          ? "Provider rate-limited. Use direct execution."
          : "Planner failed after retry. Use direct execution.",
        estimatedComplexity: "simple",
        steps: [
          {
            description: is429
              ? "Execute with a different provider or wait 60 seconds"
              : `Execute directly: ${taskDescription}`,
            toolOrSkill: is429 ? "provider-fallback" : "unknown",
          },
        ],
      };
      log.warn("Planner returning degraded fallback plan", { is429 });
      return ok(fallback);
    }

    try {
      const content = result.value.content.trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        const fallback: Plan = {
          reasoning: "Planner returned non-JSON. Falling back to direct execution.",
          estimatedComplexity: "simple",
          steps: [{ description: `Execute directly: ${taskDescription}`, toolOrSkill: "unknown" }],
        };
        log.warn("Planner returning fallback plan (no JSON)");
        return ok(fallback);
      }

      const plan = JSON.parse(jsonMatch[0]) as Plan;

      if (!plan.steps || plan.steps.length === 0) {
        const fallback: Plan = {
          reasoning: "Planner returned empty steps. Falling back to direct execution.",
          estimatedComplexity: "simple",
          steps: [{ description: `Execute directly: ${taskDescription}`, toolOrSkill: "unknown" }],
        };
        log.warn("Planner returning fallback plan (empty steps)");
        return ok(fallback);
      }

      log.info("Plan created", {
        steps: plan.steps.length,
        complexity: plan.estimatedComplexity,
      });

      return ok(plan);
    } catch {
      const fallback: Plan = {
        reasoning: "Planner JSON parse failed. Falling back to direct execution.",
        estimatedComplexity: "simple",
        steps: [{ description: `Execute directly: ${taskDescription}`, toolOrSkill: "unknown" }],
      };
      log.warn("Planner returning fallback plan (parse error)");
      return ok(fallback);
    }
  }
}
