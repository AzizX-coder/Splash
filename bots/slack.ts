/**
 * Splash Slack connector node.
 *
 * Uses Slack's Events API over a plain HTTP endpoint — no SDK dependency.
 * Configure your Slack app with:
 *   Request URL: https://<your-host>/slack/events
 *   Scopes:      app_mentions:read, chat:write, im:history, im:read
 *
 * Env:
 *   SLACK_BOT_TOKEN        xoxb-… bot user OAuth token
 *   SLACK_SIGNING_SECRET   used to verify inbound request signatures
 *   SLACK_PORT             optional, defaults to 3001
 */

import * as crypto from "node:crypto";
import * as http from "node:http";
import pc from "picocolors";
import { runChatTask, getSplash, chunkText } from "./lib/chat-agent.js";

const SLACK_API = "https://slack.com/api";
const MAX_MSG = 3500;

function verifySignature(body: string, timestamp: string, signature: string, secret: string): boolean {
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (Number.isNaN(age) || age > 60 * 5) return false;
  const base = `v0:${timestamp}:${body}`;
  const expected = "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function postMessage(token: string, channel: string, text: string, threadTs?: string) {
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text, thread_ts: threadTs }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) console.error(pc.red(`[slack] post failed: ${json.error}`));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on("data", (c: Buffer) => {
      totalSize += c.length;
      if (totalSize > 1_048_576) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function main() {
  console.log(pc.bgCyan(pc.black(" SYSTEM BOOT ")) + " Splash Slack Connector");

  const token = process.env.SLACK_BOT_TOKEN;
  const secret = process.env.SLACK_SIGNING_SECRET;
  const port = Number(process.env.SLACK_PORT || 3001);

  if (!token || !secret) {
    console.error(pc.bgRed(pc.white(" ERROR ")) + " SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET must be set.");
    process.exit(1);
  }

  getSplash(); // warm up the agent platform
  console.log(pc.green("✓ Framework initialized."));

  const seen = new Set<string>();

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/slack/events")) {
      res.writeHead(404).end();
      return;
    }

    const body = await readBody(req);
    const ts = String(req.headers["x-slack-request-timestamp"] || "");
    const sig = String(req.headers["x-slack-signature"] || "");

    if (!verifySignature(body, ts, sig, secret)) {
      res.writeHead(401).end("invalid signature");
      return;
    }

    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }

    // URL verification handshake
    if (payload.type === "url_verification") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end(payload.challenge);
      return;
    }

    // Acknowledge immediately — Slack expects <3s response
    res.writeHead(200).end();

    if (payload.type !== "event_callback") return;
    const ev = payload.event;
    if (!ev || ev.bot_id || ev.subtype) return;

    // Dedupe retries
    const eventId = payload.event_id as string;
    if (seen.has(eventId)) return;
    seen.add(eventId);
    if (seen.size > 500) seen.clear();

    const text: string = String(ev.text || "").replace(/<@[^>]+>\s*/g, "").trim();
    if (!text) return;

    console.log(pc.dim(`[slack] <${ev.channel}> ${text.slice(0, 80)}`));

    const ack = await postMessage(token, ev.channel, "⏳ Let me think…", ev.thread_ts || ev.ts);
    const { reply } = await runChatTask(text);
    for (const piece of chunkText(reply, MAX_MSG)) {
      await postMessage(token, ev.channel, piece, ev.thread_ts || ev.ts);
    }
    void ack;
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${port} is already in use.`);
      console.error(`   Another process is bound to this port.`);
      console.error(`   Fix: kill the process using port ${port}, or set SLACK_PORT=<other port>\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(pc.green(`⚡ Slack connector listening on :${port}/slack/events`));
  });

  process.once("SIGINT", () => server.close(() => process.exit(0)));
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
