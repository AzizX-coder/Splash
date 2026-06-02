import type { Result, SkillManifest, SkillResult } from "@alpclaw/utils";
import { ok, err, createError } from "@alpclaw/utils";
import type { Skill, SkillContext } from "../skill.js";


/**
 * Web scraper — fetches a URL and extracts clean Markdown content
 * using Mozilla Readability and Turndown.
 */
export class WebScraperSkill implements Skill {
  readonly manifest: SkillManifest = {
    name: "web-scraper",
    description: "Fetch a webpage and extract clean markdown content and structured answers.",
    version: "1.1.0",
    tags: ["web", "scrape", "extract", "crawl", "research", "markdown"],
    requiredConnectors: [],
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to scrape." },
        question: { type: "string", description: "Optional. What information to extract from the page. If omitted, returns the full markdown." },
      },
      required: ["url"],
    },
  };

  async execute(params: Record<string, unknown>, ctx: SkillContext): Promise<Result<SkillResult>> {
    const url = String(params.url || "");
    const question = params.question ? String(params.question) : null;
    if (!url) return err(createError("validation", "web-scraper requires url"));

    try {
      ctx.log(`Fetching URL: ${url}`);
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        }
      });
      if (!res.ok) return err(createError("skill", `HTTP ${res.status}: ${res.statusText}`));

      const html = await res.text();
      
      let Readability: any;
      let JSDOM: any;
      let TurndownService: any;
      
      try {
        const readabilityModule = await import("@mozilla/readability");
        const jsdomModule = await import("jsdom");
        const turndownModule = await import("turndown");
        Readability = readabilityModule.Readability;
        JSDOM = jsdomModule.JSDOM;
        TurndownService = turndownModule.default || turndownModule;
      } catch (err) {
        return { ok: false, error: createError("skill", "Web scraper dependencies not available. Run: pnpm install") };
      }
      
      const doc = new JSDOM(html, { url });
      const reader = new Readability(doc.window.document);
      const article = reader.parse();
      
      if (!article || !article.content) {
        return err(createError("skill", "Failed to extract article content via Readability"));
      }

      const turndownService = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
      const markdown = turndownService.turndown(article.content);

      if (!question) {
        return ok({
          success: true,
          output: { url, title: article.title, markdown },
          summary: `Extracted ${markdown.length} chars of markdown from ${url}`,
        });
      }

      const prompt = `You extracted this page text from ${url}. Answer the question strictly from this text — do not invent facts. If the answer isn't present, say so.

Question: ${question}

Page text:
"""
${markdown.slice(0, 12000)}
"""`;

      const answer = await ctx.complete(prompt, { temperature: 0.1 });
      if (!answer.ok) return answer as Result<never>;

      return ok({
        success: true,
        output: {
          url,
          title: article.title,
          question,
          answer: answer.value,
        },
        summary: answer.value,
      });
    } catch (e) {
      return err(createError("skill", String(e)));
    }
  }
}
