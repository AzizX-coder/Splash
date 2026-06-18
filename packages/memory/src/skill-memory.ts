import fs from "node:fs";
import path from "node:path";
import { globalConfigDir } from "@splash/config";

export interface SkillStats {
  successCount: number;
  failureCount: number;
  lastUsed?: string;
}

export class SkillMemory {
  private filePath: string;

  constructor() {
    const baseDir = path.join(globalConfigDir(), "memory");
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    this.filePath = path.join(baseDir, "skill-stats.json");
  }

  public getStats(): Record<string, SkillStats> {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    try {
      const content = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(content);
    } catch (e) {
      return {};
    }
  }

  public record(skillName: string, success: boolean): void {
    const stats = this.getStats();
    if (!stats[skillName]) {
      stats[skillName] = { successCount: 0, failureCount: 0 };
    }
    if (success) {
      stats[skillName].successCount += 1;
    } else {
      stats[skillName].failureCount += 1;
    }
    stats[skillName].lastUsed = new Date().toISOString();
    
    fs.writeFileSync(this.filePath, JSON.stringify(stats, null, 2), "utf8");
  }
}
