import { type Result, type SkillManifest, type SkillResult, ok, err, createError } from "@splash/utils";
import type { Skill, SkillContext } from "../skill.js";

export class NotionSyncSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "notion-sync",
    description: "Read from or write to Notion pages and databases.",
    version: "1.0.0",
    tags: ["notion", "wiki", "docs", "sync"],
    requiredConnectors: [],
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["readPage", "createPage"], description: "The action to perform." },
        pageId: { type: "string", description: "Notion Page ID (for readPage)." },
        parentId: { type: "string", description: "Notion Parent Page/Database ID (for createPage)." },
        title: { type: "string", description: "Title for new page." },
        content: { type: "string", description: "Markdown content to add to the page." },
        notionApiKey: { type: "string", description: "Notion API Key (if not provided in env NOTION_API_KEY)." }
      },
      required: ["action"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    const action = String(params.action || "");
    const apiKey = String(params.notionApiKey || process.env.NOTION_API_KEY || "");
    
    if (!apiKey) return err(createError("validation", "Missing Notion API key"));

    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    };

    try {
      if (action === "readPage") {
        const pageId = String(params.pageId || "");
        if (!pageId) return err(createError("validation", "pageId is required to read"));

        const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, { headers });
        if (!res.ok) return err(createError("skill", `Notion API error: ${res.status}`));
        
        const data = await res.json();
        return ok({
          success: true,
          output: data,
          summary: `Read ${data?.results?.length || 0} blocks from Notion page ${pageId}`
        });

      } else if (action === "createPage") {
        const parentId = String(params.parentId || "");
        if (!parentId) return err(createError("validation", "parentId is required to create"));

        // Basic payload for creating a page with a title and a text block
        const payload = {
          parent: { page_id: parentId },
          properties: {
            title: [
              { text: { content: params.title || "New Page" } }
            ]
          },
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  { text: { content: params.content || "" } }
                ]
              }
            }
          ]
        };

        const res = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errBody = await res.text();
            return err(createError("skill", `Notion API error: ${res.status} ${errBody}`));
        }
        
        const data = await res.json();
        return ok({
          success: true,
          output: data,
          summary: `Created Notion page: ${data.id}`
        });
      }

      return err(createError("validation", `Unknown action: ${action}`));
    } catch (e: any) {
      return err(createError("skill", String(e.message || e)));
    }
  }
}
