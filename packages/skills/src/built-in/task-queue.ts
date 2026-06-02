import { type Result, type SkillManifest, type SkillResult, ok, err, createError } from "@alpclaw/utils";
import type { Skill, SkillContext } from "../skill.js";
import fs from "node:fs";
import path from "node:path";
import { globalConfigDir } from "@alpclaw/config";

export class TaskQueueSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "task-queue",
    description: "Enqueue a task for the background Antigravity daemon to process later. Use this to schedule long-running background tasks.",
    version: "1.0.0",
    tags: ["task", "queue", "daemon", "background"],
    requiredConnectors: [],
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "The task objective or prompt to run." },
      },
      required: ["task"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    const task = String(params.task || "");
    if (!task) return err(createError("validation", "task is required"));
    
    try {
      const queueFile = path.join(globalConfigDir(), "queue.json");
      let queue: string[] = [];
      if (fs.existsSync(queueFile)) {
        try {
          queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));
        } catch {
          // ignore
        }
      }
      queue.push(task);
      fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2), "utf-8");

      return ok({
        success: true,
        output: { queued: true, task },
        summary: `Successfully enqueued task for Antigravity daemon.`,
      });
    } catch (e: any) {
      return err(createError("skill", String(e.message || e)));
    }
  }
}
