/**
 * Shared chat-agent helper — used by every platform adapter.
 * Keeps one Splash instance alive per process and exposes a simple
 * "text in → text out" interface so platform bots stay tiny.
 */

import { Splash } from "@splash/core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let _splash: Splash | null = null;
let _personaCache: string | undefined = undefined;

function getPersona() {
  if (_personaCache !== undefined) return _personaCache;
  const localChar = path.resolve(process.cwd(), "character.md");
  const globalChar = path.resolve(os.homedir(), ".splash", "character.md");
  
  if (fs.existsSync(localChar)) {
    _personaCache = fs.readFileSync(localChar, "utf-8");
  } else if (fs.existsSync(globalChar)) {
    _personaCache = fs.readFileSync(globalChar, "utf-8");
  } else {
    _personaCache = "";
  }
  return _personaCache;
}

export async function getSplash(): Promise<Splash> {
  if (!_splash) _splash = await Splash.create();
  return _splash;
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
    const splash = await getSplash();
    
    // Conversational Fast-Path (Sub-second response for basic chat)
    const router = splash.router;
    const fastCheck = await router.route({
       messages: [
         { role: "system", content: "You are a fast intent classifier. Does the user's message require using external tools, searching the web, reading/writing files, or doing any complex tasks? Reply strictly with 'YES' or 'NO'." },
         { role: "user", content: trimmed }
       ],
       temperature: 0,
       maxTokens: 10
    });

    if (fastCheck.ok && fastCheck.value.content.trim().toUpperCase().startsWith("NO")) {
       const quickReply = await router.route({
          messages: [
            { role: "system", content: persona || "You are Splash, a helpful and highly capable autonomous agent." },
            { role: "user", content: trimmed }
          ],
          temperature: 0.4,
          maxTokens: 1000
       });
       if (quickReply.ok) return { reply: quickReply.value.content.trim(), success: true };
    }

    // Full Agent Loop (Complex tasks)
    const agent = splash.createAgent({
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
