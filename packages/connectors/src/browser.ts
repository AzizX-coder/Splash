import type { ConnectorAction, Result, ToolDefinition } from "@splash/utils";
import { ok, err, createError, createLogger } from "@splash/utils";
import type { Connector } from "./connector.js";

const log = createLogger("connector:browser");

/**
 * Browser connector — lightweight read-only web fetching.
 *
 * Intentionally does not run JavaScript; uses `fetch` + a simple HTML→text
 * stripper to produce readable page text. Great for research tasks and RAG
 * without pulling a heavyweight headless browser dependency.
 */
export class BrowserConnector implements Connector {
  readonly name = "browser";
  readonly category = "browser" as const;
  readonly description = "Fetch a webpage and return its readable text content.";

  private timeoutMs: number;
  private maxChars: number;

  constructor(opts?: { timeoutMs?: number; maxChars?: number }) {
    this.timeoutMs = opts?.timeoutMs ?? 20_000;
    this.maxChars = opts?.maxChars ?? 40_000;
  }

  listActions(): ConnectorAction[] {
    return [
      {
        name: "fetch_text",
        description: "Fetch a webpage and return its readable text (scripts/styles stripped).",
        riskLevel: "safe",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "Absolute URL of the page to fetch." },
            selector: { type: "string", description: "Optional tag name to extract ('article', 'main', 'body')." },
          },
          required: ["url"],
        },
      },
      {
        name: "fetch_links",
        description: "Fetch a webpage and return its list of outbound links (href values).",
        riskLevel: "safe",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "Absolute URL to crawl." },
            limit: { type: "number", description: "Max number of links to return (default 50)." },
          },
          required: ["url"],
        },
      },
    ];
  }

  toToolDefinitions(): ToolDefinition[] {
    return this.listActions().map((a) => ({
      name: `${this.name}.${a.name}`,
      description: a.description,
      parameters: a.parameters,
    }));
  }

  async isAvailable(): Promise<boolean> {
    return typeof fetch === "function";
  }

  async execute(action: string, args: Record<string, unknown>): Promise<Result<unknown>> {
    const url = String(args.url || "");
    if (!/^https?:\/\//i.test(url)) {
      return err(createError("connector", "URL must be absolute http(s)."));
    }

    const html = await this.fetchHtml(url);
    if (!html.ok) return html;

    if (action === "fetch_text") {
      const selector = args.selector ? String(args.selector) : undefined;
      const scoped = selector ? this.extractTag(html.value, selector) : html.value;
      const text = this.htmlToText(scoped).slice(0, this.maxChars);
      return ok({ url, text, truncated: scoped.length > this.maxChars });
    }

    if (action === "fetch_links") {
      const limit = Number(args.limit || 50);
      const links = this.extractLinks(html.value, url).slice(0, limit);
      return ok({ url, links });
    }

    return err(createError("connector", `Unknown browser action: ${action}`));
  }

  private async fetchHtml(url: string): Promise<Result<string>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      log.debug("browser.fetch", { url });
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "SplashBot/1.0 (+https://github.com/AzizX-coder/Splash)" },
      });
      if (!res.ok) {
        return err(createError("connector", `HTTP ${res.status} for ${url}`));
      }
      const text = await res.text();
      return ok(text);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return err(createError("timeout", `Fetch timed out for ${url}`, { retryable: true }));
      }
      return err(createError("connector", `Fetch failed: ${e?.message || e}`, { retryable: true }));
    } finally {
      clearTimeout(timer);
    }
  }

  private extractTag(html: string, tag: string): string {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
    const m = html.match(re);
    return m?.[1] || html;
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/?(br|p|div|li|h[1-6])[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const out = new Set<string>();
    const re = /<a[^>]+href=(?:"([^"]+)"|'([^']+)')/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const href = m[1] || m[2];
      if (!href) continue;
      if (href.startsWith("javascript:") || href.startsWith("#")) continue;
      try {
        const absolute = new URL(href, baseUrl).toString();
        out.add(absolute);
      } catch { /* skip bad urls */ }
    }
    return Array.from(out);
  }
}
