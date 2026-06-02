/**
 * AlpClaw Discord connector node.
 *
 * Uses Discord's Interactions HTTP endpoint — no websocket gateway library
 * required. Point your bot's Interactions Endpoint URL at:
 *   https://<your-host>/discord/interactions
 *
 * Env:
 *   DISCORD_PUBLIC_KEY    Application public key (Ed25519, hex)
 *   DISCORD_BOT_TOKEN     Bot token (used for follow-up messages)
 *   DISCORD_PORT          optional, defaults to 3004
 */

import * as crypto from "node:crypto";
import * as http from "node:http";
import pc from "picocolors";
import { runChatTask, getAlpClaw, chunkText } from "./lib/chat-agent.js";

const DISCORD_API = "https://discord.com/api/v10";
const MAX_MSG = 1900;

function verifyEd25519(body: string, signature: string, timestamp: string, publicKeyHex: string): boolean {
  try {
    const sig = Buffer.from(signature, "hex");
    const keyDer = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKeyHex, "hex"),
    ]);
    const pub = crypto.createPublicKey({ key: keyDer, format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(timestamp + body), pub, sig);
  } catch {
    return false;
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

async function sendFollowup(appId: string, token: string, text: string) {
  const res = await fetch(`${DISCORD_API}/webhooks/${appId}/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  if (!res.ok) console.error(pc.red(`[discord] followup failed: ${res.status} ${await res.text()}`));
}

async function main() {
  console.log(pc.bgCyan(pc.black(" SYSTEM BOOT ")) + " AlpClaw Discord Connector");

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const port = Number(process.env.DISCORD_PORT || 3004);

  if (!publicKey) {
    console.error(pc.bgRed(pc.white(" ERROR ")) + " DISCORD_PUBLIC_KEY must be set.");
    process.exit(1);
  }

  if (!botToken) {
    console.error("Missing DISCORD_BOT_TOKEN. Set it in env or via: splash config set-bot discord DISCORD_BOT_TOKEN <token>");
    process.exit(1);
  }

  getAlpClaw();
  console.log(pc.green("✓ Framework initialized."));

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/discord/interactions")) {
      res.writeHead(404).end();
      return;
    }

    const body = await readBody(req);
    const sig = String(req.headers["x-signature-ed25519"] || "");
    const ts  = String(req.headers["x-signature-timestamp"] || "");

    if (!verifyEd25519(body, sig, ts, publicKey)) {
      res.writeHead(401).end("invalid signature");
      return;
    }

    let payload: any;
    try { payload = JSON.parse(body); } catch { res.writeHead(400).end(); return; }

    // Type 1: PING — respond with PONG
    if (payload.type === 1) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ type: 1 }));
      return;
    }

    // Type 2: Application command — defer and process async
    if (payload.type === 2) {
      res.writeHead(200, { "Content-Type": "application/json" })
         .end(JSON.stringify({ type: 5 })); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE

      const opts = payload.data?.options || [];
      const prompt = opts.find((o: any) => o.name === "prompt")?.value || "";
      const text = String(prompt).trim();

      console.log(pc.dim(`[discord] ${payload.data?.name}: ${text.slice(0, 80)}`));

      const { reply } = text ? await runChatTask(text) : { reply: "Please provide a prompt." };
      for (const piece of chunkText(reply, MAX_MSG)) {
        await sendFollowup(payload.application_id, payload.token, piece);
      }
      return;
    }

    // Anything else: acknowledge but ignore
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ type: 1 }));
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${port} is already in use.`);
      console.error(`   Another process is bound to this port.`);
      console.error(`   Fix: kill the process using port ${port}, or set DISCORD_PORT=<other port>\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(pc.green(`⚡ Discord connector listening on :${port}/discord/interactions`));
    console.log(pc.dim("   Register a slash command with an option named 'prompt'."));
  });

  process.once("SIGINT", () => server.close(() => process.exit(0)));
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
