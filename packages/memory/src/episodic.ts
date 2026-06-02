import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { globalConfigDir } from "@alpclaw/config";

export interface MessageEntry {
  role: string;
  content: string;
  timestamp: string;
  [key: string]: any;
}

export class EpisodicMemory {
  private baseDir: string;

  constructor() {
    this.baseDir = path.join(globalConfigDir(), "memory", "sessions");
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getSessionFile(sessionId: string): string {
    return path.join(this.baseDir, `${sessionId}.jsonl`);
  }

  public append(sessionId: string, message: MessageEntry): void {
    const filePath = this.getSessionFile(sessionId);
    const line = JSON.stringify(message) + "\n";
    fs.appendFileSync(filePath, line, "utf8");
  }

  public async getLastNMessages(sessionId: string, n: number): Promise<MessageEntry[]> {
    const filePath = this.getSessionFile(sessionId);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const lines: string[] = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (line.trim()) {
        lines.push(line);
      }
    }

    return lines.slice(-n).map((line) => JSON.parse(line));
  }

  public async search(query: string, maxResults: number = 10): Promise<{ sessionId: string, message: MessageEntry }[]> {
    const results: { sessionId: string, message: MessageEntry }[] = [];
    if (!fs.existsSync(this.baseDir)) return results;
    
    const files = fs.readdirSync(this.baseDir).filter((file) => file.endsWith(".jsonl"));
    const regex = new RegExp(query, "i");

    for (const file of files) {
      const sessionId = path.basename(file, ".jsonl");
      const filePath = path.join(this.baseDir, file);
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (line.trim() && regex.test(line)) {
          try {
            results.push({ sessionId, message: JSON.parse(line) });
            if (results.length >= maxResults) {
              return results;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    
    return results;
  }
}
