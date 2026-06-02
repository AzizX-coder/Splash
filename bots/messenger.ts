/**
 * AlpClaw Facebook Messenger connector node.
 *
 * Configure your Messenger app's webhook with:
 *   Callback URL: https://<your-host>/messenger/webhook
 *   Subscribe to: messages, messaging_postbacks
 *
 * Env:
 *   MESSENGER_VERIFY_TOKEN  matches Meta's webhook-verify challenge
 *   MESSENGER_PAGE_TOKEN    page access token (for sending replies)
 *   MESSENGER_PORT          optional, defaults to 3003
 */

import * as http from "node:http";
import pc from "picocolors";
import { runChatTask, getAlpClaw, chunkText } from "./lib/chat-agent.js";

const GRAPH = "https://graph.facebook.com/v19.0";
const MAX_MSG = 1900; // Messenger hard limit is 2000

async function sendMessage(pageToken: string, recipientId: string, text: string) {
  const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text },
    }),
  });
  if (!res.ok) {
    console.error(pc.red(`[messenger] send failed: ${res.status} ${await res.text()}`));
  }
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
  console.log(pc.bgCyan(pc.black(" SYSTEM BOOT ")) + " AlpClaw Messenger Connector");

  const verifyToken = process.env.MESSENGER_VERIFY_TOKEN;
  const pageToken = process.env.MESSENGER_PAGE_TOKEN;
  const port = Number(process.env.MESSENGER_PORT || 3003);

  if (!verifyToken || !pageToken) {
    console.error(pc.bgRed(pc.white(" ERROR ")) + " MESSENGER_VERIFY_TOKEN and MESSENGER_PAGE_TOKEN must be set.");
    process.exit(1);
  }

  getAlpClaw();
  console.log(pc.green("✓ Framework initialized."));

  const seen = new Set<string>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    // Webhook verification handshake
    if (req.method === "GET" && url.pathname === "/messenger/webhook") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === verifyToken && challenge) {
        res.writeHead(200, { "Content-Type": "text/plain" }).end(challenge);
      } else {
        res.writeHead(403).end();
      }
      return;
    }

    if (req.method !== "POST" || url.pathname !== "/messenger/webhook") {
      res.writeHead(404).end();
      return;
    }

    const body = await readBody(req);
    res.writeHead(200).end("EVENT_RECEIVED");

    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      return;
    }

    if (payload.object !== "page") return;

    for (const entry of payload.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const msg = event.message;
        if (!senderId || !msg || msg.is_echo) continue;
        const text = String(msg.text || "").trim();
        if (!text) continue;

        const mid = msg.mid as string;
        if (mid && seen.has(mid)) continue;
        if (mid) {
          seen.add(mid);
          if (seen.size > 500) seen.clear();
        }

        console.log(pc.dim(`[messenger] <${senderId}> ${text.slice(0, 80)}`));

        await sendMessage(pageToken, senderId, "⏳ Let me think…");
        const { reply } = await runChatTask(text);
        for (const piece of chunkText(reply, MAX_MSG)) {
          await sendMessage(pageToken, senderId, piece);
        }
      }
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${port} is already in use.`);
      console.error(`   Another process is bound to this port.`);
      console.error(`   Fix: kill the process using port ${port}, or set MESSENGER_PORT=<other port>\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(pc.green(`⚡ Messenger connector listening on :${port}/messenger/webhook`));
  });

  process.once("SIGINT", () => server.close(() => process.exit(0)));
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
