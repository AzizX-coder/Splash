/**
 * AlpClaw Telegram connector node.
 *
 * Configure:
 *   TELEGRAM_BOT_TOKEN    from @BotFather
 *
 * Features:
 *   - Auto-fetches bot identity via getMe() and prints "Connected as @username"
 *   - Live-logs incoming and outgoing messages in the terminal
 *   - Uses character.md persona if present
 */

import { Telegraf, Markup } from "telegraf";
import pc from "picocolors";
import { runChatTask, getAlpClaw, chunkText } from "./lib/chat-agent.js";
import { readGlobalConfig, writeGlobalConfig } from "@alpclaw/config";
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_MSG = 3800;

function ts() {
  return pc.dim(new Date().toLocaleTimeString());
}

async function main() {
  console.log("");
  console.log(pc.bgCyan(pc.black(" SPLASH ")) + pc.cyan(" Telegram Bridge"));
  console.log("");

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error(pc.bgRed(pc.white(" ERROR ")) + " TELEGRAM_BOT_TOKEN is not set.");
    console.error(pc.dim("Run: splash config set-bot telegram TELEGRAM_BOT_TOKEN <token>"));
    process.exit(1);
  }

  // Initialize the agent framework
  getAlpClaw();
  const bot = new Telegraf(token);

  // Auto-identify — fetch bot info from Telegram API
  try {
    const me = await bot.telegram.getMe();
    console.log(pc.green("✓") + ` Connected as ${pc.bold("@" + me.username)} (${me.first_name})`);
    console.log(pc.dim(`  Bot ID: ${me.id} | Can join groups: ${me.can_join_groups}`));
  } catch (e: any) {
    console.error(pc.red("✗ Failed to connect:"), e.message);
    process.exit(1);
  }

  console.log(pc.dim("─".repeat(60)));
  console.log(pc.dim("Waiting for messages... (Ctrl+C to stop)\n"));

  bot.command("start", async (ctx) => {
    try {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🚀 Run Agent", "start:run"), Markup.button.callback("📊 Stats", "start:stats")],
        [Markup.button.callback("⚙️ Settings", "start:settings"), Markup.button.callback("❓ Help", "start:help")],
      ]);
      await ctx.reply("👋 Welcome to Splash! I'm your autonomous agent. What would you like to do?", keyboard);
    } catch (e: any) {
      await ctx.reply("⚠️ Failed to start. Please try again.");
    }
  });

  bot.command("help", async (ctx) => {
    const helpText = `
*Splash Commands:*
/start - Main menu
/provider - Switch default provider
/mode - Change safety mode
/memory <query> - Search episodic memory
/profile - Show user profile summary
/stats - Show agent statistics
/help - Show this message
    `.trim();
    await ctx.replyWithMarkdown(helpText);
  });

  bot.command("memory", async (ctx) => {
    try {
      const query = ctx.message.text.substring(7).trim();
      if (!query) {
        await ctx.reply("⚠️ Usage: /memory <query>");
        return;
      }
      
      const home = process.env.HOME || process.env.USERPROFILE || "";
      const sessionsDir = path.resolve(home, ".splash", "memory", "sessions");
      if (!fs.existsSync(sessionsDir)) {
        await ctx.reply("ℹ️ No memory sessions found.");
        return;
      }
      
      const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
      let matches = [];
      for (const file of files) {
        const content = fs.readFileSync(path.join(sessionsDir, file), "utf-8");
        const lines = content.split("\\n").filter((l) => l.toLowerCase().includes(query.toLowerCase()));
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            matches.push(`- ${(parsed.content || parsed.text || "").slice(0, 100)}...`);
          } catch {
            matches.push(`- ${line.slice(0, 100)}...`);
          }
        }
      }
      
      if (matches.length === 0) {
        await ctx.reply(`🔍 No memory matches found for "${query}".`);
      } else {
        const reply = `🔍 Found ${matches.length} matches for "${query}":\\n\\n${matches.slice(0, 10).join("\\n")}`;
        await ctx.reply(reply.slice(0, 3800));
      }
    } catch (e: any) {
      await ctx.reply("⚠️ Failed to search memory. Please try again.");
    }
  });

  bot.command("profile", async (ctx) => {
    try {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      const profilePath = path.resolve(home, ".splash", "memory", "user-profile.json");
      if (!fs.existsSync(profilePath)) {
        await ctx.reply("ℹ️ No user profile data found yet.");
        return;
      }
      const profile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
      const facts = profile.facts || [];
      if (facts.length === 0) {
        await ctx.reply("ℹ️ User profile is currently empty.");
        return;
      }
      const reply = `👤 *User Profile Facts:*\\n\\n${facts.map((f: any) => `- ${f}`).join("\\n")}`;
      await ctx.replyWithMarkdown(reply.slice(0, 3800));
    } catch (e: any) {
      await ctx.reply("⚠️ Failed to load profile. Please try again.");
    }
  });

  bot.command("stats", async (ctx) => {
    try {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      const sessionsDir = path.resolve(home, ".splash", "memory", "sessions");
      let runCount = 0;
      if (fs.existsSync(sessionsDir)) {
        runCount = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl")).length;
      }
      const cfg = readGlobalConfig();
      const provider = cfg.providers?.default || "none";
      
      const reply = `📊 *Splash Agent Stats:*\\n\\nTotal Runs: ${runCount}\\nDefault Provider: ${provider}`;
      await ctx.replyWithMarkdown(reply);
    } catch (e: any) {
      await ctx.reply("⚠️ Failed to load stats. Please try again.");
    }
  });

  bot.command("mode", async (ctx) => {
    try {
      const cfg = readGlobalConfig();
      const currentMode = cfg.safety?.mode || "permissive";
      
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback(currentMode === "permissive" ? "✅ Permissive" : "Permissive", "mode:permissive"),
        Markup.button.callback(currentMode === "strict" ? "✅ Strict" : "Strict", "mode:strict"),
      ]);
      
      await ctx.reply("Select safety mode:", keyboard);
    } catch (e: any) {
      await ctx.reply("⚠️ Failed to load modes. Please try again.");
    }
  });

  bot.command("provider", async (ctx) => {
    try {
      const alpclaw = await getAlpClaw();
      const providers = alpclaw.router.listProviders();
      const current = readGlobalConfig().providers?.default || "openrouter";
      
      const buttons = providers.map(p => [
        Markup.button.callback(current === p.name ? `✅ ${p.name}` : p.name, `provider:${p.name}`)
      ]);
      
      await ctx.reply("Select default provider:", Markup.inlineKeyboard(buttons));
    } catch (e: any) {
      await ctx.reply("⚠️ Failed to load providers. Please try again.");
    }
  });

  bot.on("callback_query", async (ctx) => {
    try {
      const cb = ctx.callbackQuery as any;
      if (!cb.data) return;
      
      const [action, value] = cb.data.split(":");
      const cfg = readGlobalConfig();
      
      if (action === "mode") {
        cfg.safety = cfg.safety || { mode: "permissive" };
        cfg.safety.mode = value as "permissive" | "strict";
        writeGlobalConfig(cfg);
        await ctx.editMessageText(`✅ Safety mode set to ${value}.`);
      } else if (action === "provider") {
        cfg.providers = cfg.providers || { default: value, apiKeys: {} };
        cfg.providers.default = value;
        writeGlobalConfig(cfg);
        await ctx.editMessageText(`✅ Provider set to ${value}.`);
      } else if (action === "start") {
        if (value === "run") {
          await ctx.editMessageText("🚀 Send me a message to start running the agent.");
        } else if (value === "stats") {
          await ctx.editMessageText("📊 Run /stats to see your usage.");
        } else if (value === "settings") {
          await ctx.editMessageText("⚙️ Run /mode or /provider to change settings.");
        } else if (value === "help") {
          await ctx.editMessageText("❓ Run /help for a list of commands.");
        }
      }
      
      await ctx.answerCbQuery();
    } catch (e: any) {
       await ctx.answerCbQuery("Error processing request.").catch(() => null);
    }
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    const from = ctx.message.from;
    const chatId = ctx.chat.id;
    const msgId = ctx.message.message_id;
    const userName = from.username ? `@${from.username}` : from.first_name;

    // Live-log incoming message
    console.log(`${ts()} ${pc.cyan("◀ IN")}  ${pc.bold(userName)} ${pc.dim(`(chat ${chatId})`)}`);
    console.log(`       ${text.length > 120 ? text.slice(0, 120) + "…" : text}`);

    const waitingMsg = await ctx.reply("⏳ Thinking...", {
      reply_parameters: { message_id: msgId },
    });

    const startMs = Date.now();
    let reply = "";
    let success = false;
    let attempts = 0;
    const maxAttempts = 2;
    
    while (attempts < maxAttempts) {
      attempts++;
      const res = await runChatTask(text);
      reply = res.reply;
      success = res.success;
      if (success || attempts >= maxAttempts) break;
      console.log(`${ts()} ${pc.yellow("⚠ RETRY")} Attempt ${attempts} failed, retrying...`);
    }

    if (!success) {
       // Friendly error wrapper — hide stack trace from user
       reply = "⚠️ I encountered an internal error while processing your request. Please check the terminal logs or try again later.";
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    const pieces = chunkText(reply, MAX_MSG);

    try {
      await ctx.telegram.editMessageText(chatId, waitingMsg.message_id, undefined, pieces[0]!);
      for (let i = 1; i < pieces.length; i++) {
        await ctx.reply(pieces[i]!, { reply_parameters: { message_id: msgId } });
      }

      // Live-log outgoing reply
      const statusIcon = success ? pc.green("✓") : pc.red("✗");
      console.log(`${ts()} ${pc.magenta("▶ OUT")} ${statusIcon} ${pc.dim(`(${elapsed}s, ${pieces.length} msg${pieces.length > 1 ? "s" : ""})`)}`);
      console.log(`       ${reply.length > 120 ? reply.slice(0, 120) + "…" : reply}`);
      console.log("");
    } catch (e: any) {
      console.log(`${ts()} ${pc.red("▶ ERR")} Failed to deliver: ${e.message}`);
      await ctx.telegram.editMessageText(
        chatId,
        waitingMsg.message_id,
        undefined,
        "⚠️ Failed to deliver reply: " + String(e?.message || e),
      );
    }
  });

  bot.launch();
  console.log(pc.green("⚡ Bot is live and listening!"));

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
