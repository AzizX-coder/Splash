/**
 * Structured logger for AlpClaw.
 * Simple, no external deps, supports log levels and structured data.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

const RESET = "\x1b[0m";

export interface LogEntry {
  level: LogLevel;
  message: string;
  scope?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export class Logger {
  private minLevel: LogLevel;
  private scope: string;

  constructor(scope: string, minLevel: LogLevel = "info") {
    this.scope = scope;
    this.minLevel = minLevel;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  child(scope: string): Logger {
    return new Logger(`${this.scope}:${scope}`, this.minLevel);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const timestamp = new Date().toISOString();
    const color = LEVEL_COLORS[level];
    const levelTag = level.toUpperCase().padEnd(5);
    const prefix = `${color}[${levelTag}]${RESET} ${"\x1b[90m"}${timestamp}${RESET} ${"\x1b[35m"}[${this.scope}]${RESET}`;

    const parts = [prefix, message];
    if (data && Object.keys(data).length > 0) {
      parts.push(`\x1b[90m${JSON.stringify(data)}${RESET}`);
    }

    const output = parts.join(" ");

    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

/** Global root logger. Packages create children from this. */
let rootLogger: Logger | undefined;

export function getRootLogger(): Logger {
  if (!rootLogger) {
    const envLevel = (process.env["SPLASH_LOG_LEVEL"] || process.env["ALPCLAW_LOG_LEVEL"] || "warn") as LogLevel;
    rootLogger = new Logger("splash", envLevel);
  }
  return rootLogger;
}

export function createLogger(scope: string): Logger {
  return getRootLogger().child(scope);
}
