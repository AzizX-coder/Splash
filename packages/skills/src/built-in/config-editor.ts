import { type Result, type SkillManifest, type SkillResult, ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";
import { readGlobalConfig, writeGlobalConfig } from "@splash/config";

export class ConfigEditorSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "config-editor",
    description: "Read or edit the global agent configuration (e.g. ~/.splash/config.json). Use this to persist settings, themes, or provider changes.",
    version: "1.0.0",
    tags: ["config", "settings", "preferences", "system"],
    requiredConnectors: [],
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "update"], description: "The action to perform." },
        keyPath: { type: "string", description: "Dot-separated path to the config key (e.g. 'safety.mode' or 'cli.style'). Required for 'update'." },
        value: { type: "string", description: "The new JSON-serializable value. Required for 'update'." }
      },
      required: ["action"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    const action = String(params.action || "");
    
    try {
      const cfg = readGlobalConfig();

      if (action === "read") {
        return ok({
          success: true,
          output: cfg,
          summary: "Successfully read global configuration.",
        });
      } else if (action === "update") {
        const keyPath = String(params.keyPath || "");
        if (!keyPath) return err(createError("validation", "keyPath is required for update"));
        
        // Basic dot-notation assignment
        const keys = keyPath.split(".");
        let current: any = cfg;
        for (let i = 0; i < keys.length - 1; i++) {
          const k = keys[i] as string;
          if (typeof current[k] !== "object") {
             current[k] = {};
          }
          current = current[k];
        }
        
        let parsedValue = params.value;
        try {
           parsedValue = JSON.parse(String(params.value));
        } catch (e) {
           // Treat as raw string if it doesn't parse
        }
        
        const lastKey = keys[keys.length - 1] as string;
        current[lastKey] = parsedValue;

        writeGlobalConfig(cfg);

        return ok({
          success: true,
          output: cfg,
          summary: `Successfully updated config key '${keyPath}' to ${JSON.stringify(parsedValue)}.`,
        });
      }

      return err(createError("validation", `Unknown action: ${action}`));
    } catch (e: any) {
      return err(createError("skill", String(e.message || e)));
    }
  }
}
