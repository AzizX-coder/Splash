import type { SkillManifest } from "@splash/utils";
import { createLogger } from "@splash/utils";
import type { Skill } from "./skill.js";

const log = createLogger("skills:registry");

/**
 * SkillRegistry manages available skills and supports discovery.
 */
export class SkillRegistry {
  private skills = new Map<string, Skill>();

  /** Register a skill. */
  register(skill: Skill): void {
    this.skills.set(skill.manifest.name, skill);
    log.info("Skill registered", {
      name: skill.manifest.name,
      tags: skill.manifest.tags,
    });
  }

  /** Get a skill by name. */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** List all registered skills. */
  list(): SkillManifest[] {
    return Array.from(this.skills.values()).map((s) => s.manifest);
  }

  /** Find skills by tag. */
  findByTag(tag: string): Skill[] {
    return Array.from(this.skills.values()).filter((s) =>
      s.manifest.tags.includes(tag),
    );
  }

  /** Find the best skill for a task description using keyword matching. */
  findForTask(description: string): Skill | undefined {
    const lower = description.toLowerCase();
    let bestMatch: { skill: Skill; score: number } | undefined;

    for (const skill of this.skills.values()) {
      let score = 0;

      // Match against skill name
      if (lower.includes(skill.manifest.name.toLowerCase())) score += 5;

      // Match against tags
      for (const tag of skill.manifest.tags) {
        if (lower.includes(tag.toLowerCase())) score += 2;
      }

      // Match against description words
      const descWords = skill.manifest.description.toLowerCase().split(/\s+/);
      for (const word of descWords) {
        if (word.length > 3 && lower.includes(word)) score += 1;
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { skill, score };
      }
    }

    return bestMatch?.skill;
  }
}
