/**
 * Splash WhatsApp connector node — Twilio-compatible webhook.
 *
 * Configure a Twilio WhatsApp Sender to POST messages to:
 *   https://<your-host>/whatsapp/incoming
 *
 * Env:
 *   TWILIO_AUTH_TOKEN       Twilio auth token (for signature verification)
 *   WHATSAPP_PORT           optional, defaults to 3002
 *   WHATSAPP_VERIFY_SIG     set to "false" to disable signature checks in dev
 */

import * as crypto from "node:crypto";
import * as http from "node:http";
import pc from "picocolors";
import { runChatTask, getSplash, chunkText } from "./lib/chat-agent.js";

function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    if (!pair) continue;
    const [k, v = ""] = pair.split("=");
    out[decodeURIComponent(k!.replace(/\+/g, " "))] = decodeURIComponent(v.replace(/\+/g, " "));
  }
  return out;
}

function twilioSignatureValid(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string,
): boolean {
  const keys = Object.keys(params).sort();
  let data = url;
  for (const k of keys) data += k + params[k];
  const expected = crypto.createHmac("sha1", authToken).update(data).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
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

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function twiml(texts: string[]): string {
  const messages = texts.map((t) => `<Message>${escapeXml(t)}</Message>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${messages}</Response>`;
}

async function main() {
  console.log(pc.bgCyan(pc.black(" SYSTEM BOOT ")) + " Splash WhatsApp Connector");

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const port = Number(process.env.WHATSAPP_PORT || 3002);
  const verifySig = process.env.WHATSAPP_VERIFY_SIG !== "false";

  if (verifySig && !authToken) {
    console.error(pc.bgRed(pc.white(" ERROR ")) + " TWILIO_AUTH_TOKEN must be set (or WHATSAPP_VERIFY_SIG=false for dev).");
    process.exit(1);
  }

  getSplash();
  console.log(pc.green("✓ Framework initialized."));

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/whatsapp/incoming")) {
      res.writeHead(404).end();
      return;
    }

    const body = await readBody(req);
    const params = parseForm(body);

    if (verifySig) {
      const sig = String(req.headers["x-twilio-signature"] || "");
      const proto = (req.headers["x-forwarded-proto"] as string) || "https";
      const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
      const fullUrl = `${proto}://${host}${req.url}`;
      if (!twilioSignatureValid(fullUrl, params, sig, authToken!)) {
        res.writeHead(401, { "Content-Type": "text/plain" }).end("invalid signature");
        return;
      }
    }

    const from = params["From"] || "unknown";
    const text = (params["Body"] || "").trim();
    if (!text) {
      res.writeHead(200, { "Content-Type": "text/xml" }).end(twiml(["Please send a non-empty message."]));
      return;
    }

    console.log(pc.dim(`[whatsapp] <${from}> ${text.slice(0, 80)}`));
    const { reply } = await runChatTask(text);
    const chunks = chunkText(reply, 1500);
    res.writeHead(200, { "Content-Type": "text/xml" }).end(twiml(chunks));
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${port} is already in use.`);
      console.error(`   Another process is bound to this port.`);
      console.error(`   Fix: kill the process using port ${port}, or set WHATSAPP_PORT=<other port>\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(pc.green(`⚡ WhatsApp connector listening on :${port}/whatsapp/incoming`));
  });

  process.once("SIGINT", () => server.close(() => process.exit(0)));
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
