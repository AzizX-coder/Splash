/**
 * Shared chat-agent helper — used by every platform adapter.
 * Keeps one AlpClaw instance alive per process and exposes a simple
 * "text in → text out" interface so platform bots stay tiny.
 */

import { AlpClaw } from "@alpclaw/core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let _alpclaw: AlpClaw | null = null;
let _personaCache: string | undefined = undefined;

function getPersona() {
  if (_personaCache !== undefined) return _personaCache;
  const localChar = path.resolve(process.cwd(), "character.md");
  const globalChar = path.resolve(os.homedir(), ".alpclaw", "character.md");
  
  if (fs.existsSync(localChar)) {
    _personaCache = fs.readFileSync(localChar, "utf-8");
  } else if (fs.existsSync(globalChar)) {
    _personaCache = fs.readFileSync(globalChar, "utf-8");
  } else {
    _personaCache = "";
  }
  return _personaCache;
}

export async function getAlpClaw(): Promise<AlpClaw> {
  if (!_alpclaw) _alpclaw = await AlpClaw.create();
  return _alpclaw;
}

export interface ChatRunResult {
  reply: string;
  success: boolean;
}

export async function runChatTask(text: string): Promise<ChatRunResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { reply: "Please send a non-empty message.", success: false };
  }

  try {
    const persona = getPersona();
    const alpclaw = await getAlpClaw();
    const agent = alpclaw.createAgent({
      systemPersona: persona ? persona : undefined
    });
    const result = await agent.run(trimmed);
    if (result.ok) {
      const summary = result.value.result?.summary?.trim();
      return {
        reply: summary && summary.length > 0 ? summary : "Task completed — no verbal summary.",
        success: true,
      };
    }
    return { reply: `❌ ${result.error.message}`, success: false };
  } catch (e: any) {
    return { reply: `⚠️ Fatal: ${e?.message || String(e)}`, success: false };
  }
}

/** Common helper for replying in chunks when a platform caps message length. */
export function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return chunks;
}
