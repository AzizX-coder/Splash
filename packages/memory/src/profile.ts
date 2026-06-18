import fs from "node:fs";
import path from "node:path";
import { globalConfigDir } from "@splash/config";

export interface UserProfileData {
  name?: string;
  timezone?: string;
  language?: string;
  codingStyle?: string;
  tone?: string;
  projectContext?: string;
  preferences?: Record<string, any>;
}

export class UserProfile {
  private filePath: string;

  constructor() {
    const baseDir = path.join(globalConfigDir(), "memory");
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    this.filePath = path.join(baseDir, "user-profile.json");
  }

  public read(): UserProfileData {
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

  public update(data: Partial<UserProfileData>): UserProfileData {
    const current = this.read();
    const updated = { ...current, ...data };
    
    if (current.preferences && data.preferences) {
      updated.preferences = { ...current.preferences, ...data.preferences };
    }
    
    fs.writeFileSync(this.filePath, JSON.stringify(updated, null, 2), "utf8");
    return updated;
  }
}
