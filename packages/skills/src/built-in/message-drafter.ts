import type { SkillManifest, SkillResult, Result } from "@splash/utils";
import { ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

export class MessageDrafterSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "message-drafter",
    description: "Draft messages for outreach, social posts, emails, PR descriptions, or announcements",
    version: "1.0.0",
    tags: ["message", "draft", "outreach", "social", "email", "communication"],
    requiredConnectors: [],
    parameters: {
      type: "object",
      properties: {
        purpose: {
          type: "string",
          description: "What the message is for (e.g., 'cold outreach', 'product launch tweet', 'bug report email')",
        },
        context: {
          type: "string",
          description: "Background context for the message",
        },
        tone: {
          type: "string",
          enum: ["professional", "casual", "friendly", "formal", "urgent"],
          description: "Desired tone",
        },
        platform: {
          type: "string",
          enum: ["email", "slack", "discord", "twitter", "linkedin", "telegram", "generic"],
          description: "Target platform (affects format and length)",
        },
        maxLength: { type: "number", description: "Maximum character count" },
      },
      required: ["purpose"],
    },
  };

  async execute(
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<Result<SkillResult>> {
    const purpose = params["purpose"] as string;
    const context = (params["context"] as string) || "";
    const tone = (params["tone"] as string) || "professional";
    const platform = (params["platform"] as string) || "generic";
    const maxLength = (params["maxLength"] as number) || 0;

    if (!purpose) return err(createError("skill", "purpose is required"));

    ctx.log("Drafting message", { purpose, tone, platform });

    const platformGuidelines: Record<string, string> = {
      email: "Format as an email with subject line and body. Professional structure.",
      slack: "Keep it concise. Use Slack formatting (bold, bullet points). No subject line.",
      discord: "Casual but clear. Can use markdown. Keep it engaging.",
      twitter: "Must be 280 characters or less. Punchy and shareable. Use hashtags if appropriate.",
      linkedin: "Professional and insightful. Can be longer. Use line breaks for readability.",
      telegram: "Short and direct. Can use markdown formatting.",
      generic: "Clean, well-structured message appropriate for the purpose.",
    };

    const lengthConstraint = maxLength > 0
      ? `Keep the message under ${maxLength} characters.`
      : platform === "twitter"
        ? "Must be under 280 characters."
        : "";

    const prompt = `Draft a message for the following purpose:

Purpose: ${purpose}
${context ? `Context: ${context}` : ""}
Tone: ${tone}
Platform: ${platform}
${platformGuidelines[platform] || platformGuidelines["generic"]}
${lengthConstraint}

Write only the message, ready to send. No meta-commentary.`;

    const result = await ctx.complete(prompt, { temperature: 0.6 });
    if (!result.ok) return result as Result<never>;

    return ok({
      success: true,
      output: {
        message: result.value,
        purpose,
        tone,
        platform,
        length: result.value.length,
      },
      summary: `Drafted ${platform} message (${tone} tone, ${result.value.length} chars)`,
    });
  }
}
