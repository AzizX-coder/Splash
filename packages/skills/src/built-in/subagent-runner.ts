import type { SkillManifest, SkillResult, Result } from "@alpclaw/utils";
import { ok, err, createError } from "@alpclaw/utils";
import type { Skill, SkillContext } from "../skill.js";
// Dynamic import used later to avoid circular dependency with @alpclaw/core
/**
 * SubagentRunnerSkill — spawns parallel autonomous sub-agents for complex tasks.
 *
 * When the Planner generates independent objectives, the master agent can
 * invoke this skill to delegate them to fresh, zero-context sub-agents that
 * execute in parallel. This drastically reduces token usage since each
 * sub-agent starts with a clean slate rather than inheriting the master's
 * bloated context window.
 */
export class SubagentRunnerSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "subagent-runner",
    description:
      "Delegates independent tasks to fully autonomous AlpClaw sub-agents running in parallel. " +
      "Ideal for drastically speeding up complex multi-step routines like analyzing multiple files, " +
      "writing tests across separated folders, or scraping many pages simultaneously.",
    version: "1.0.0",
    tags: ["subagent", "delegate", "multitask", "parallel", "swarm"],
    requiredConnectors: [],
    parameters: {
      type: "object",
      properties: {
        objectives: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of distinct, self-contained prompts. Each will run in a separate sub-agent in parallel.",
        },
      },
      required: ["objectives"],
    },
  };

  async execute(
    params: Record<string, unknown>,
    _context: SkillContext,
  ): Promise<Result<SkillResult>> {
    try {
      const objectives = params.objectives as string[] | undefined;

      if (!objectives || !Array.isArray(objectives) || objectives.length === 0) {
        return err(createError("skill", "objectives must be a non-empty array of strings."));
      }

      _context.log(`Spawning ${objectives.length} sub-agent(s) in parallel`);

      // Execute all sub-agents concurrently
      const promises = objectives.map((obj) => this.invokeSubagent(obj));
      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      const summary = [
        `Dispatched ${objectives.length} sub-agent(s): ${successes.length} succeeded, ${failures.length} failed.`,
        ...results.map((r, i) => `  [${i + 1}] ${r.success ? "✓" : "✗"} ${r.text.slice(0, 200)}`),
      ].join("\n");

      return ok({
        success: failures.length === 0,
        output: results,
        summary,
        sideEffects: objectives.map((o) => `sub-agent: ${o.slice(0, 80)}`),
      });
    } catch (e) {
      return err(createError("skill", `Subagent dispatch failed: ${String(e)}`));
    }
  }

  private async invokeSubagent(objective: string): Promise<{ success: boolean; text: string }> {
    try {
      const core = await import("@alpclaw/core");
      const alpclaw = core.AlpClaw.create();
      const agent = alpclaw.createAgent({
        // Subagents run silently — no spinners or phase logs
        onPhaseChange: () => {},
        onToolCall: () => {},
      });
      const res = await agent.run(objective);
      if (res.ok) {
        return {
          success: true,
          text:
            res.value.result?.summary ||
            `Completed: ${objective.slice(0, 100)}`,
        };
      }
      return { success: false, text: `Failed: ${res.error.message}` };
    } catch (e) {
      return { success: false, text: `Crashed: ${String(e)}` };
    }
  }
}
