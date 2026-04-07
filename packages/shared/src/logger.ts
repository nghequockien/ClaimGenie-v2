import { AgentName, LogLevel } from "./types";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  agentName?: AgentName;
  claimId?: string;
  taskId?: string;
  message: string;
  details?: unknown;
}

type LogFn = (message: string, details?: unknown) => void;

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

let logCallback: ((entry: LogEntry) => void) | null = null;

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

function resolveLogLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.trim().toUpperCase();

  if (
    configured === "DEBUG" ||
    configured === "INFO" ||
    configured === "WARN" ||
    configured === "ERROR"
  ) {
    return configured;
  }

  return process.env.NODE_ENV === "production" ? "INFO" : "DEBUG";
}

function shouldLog(level: LogLevel): boolean {
  const activeLevel = resolveLogLevel();
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[activeLevel];
}

export function setLogCallback(cb: (entry: LogEntry) => void) {
  logCallback = cb;
}

function colorize(level: LogLevel, text: string): string {
  const colors: Record<LogLevel, string> = {
    DEBUG: "\x1b[36m",
    INFO: "\x1b[32m",
    WARN: "\x1b[33m",
    ERROR: "\x1b[31m",
  };
  return `${colors[level]}${text}\x1b[0m`;
}

export function createLogger(
  agentName?: AgentName,
  claimId?: string,
  taskId?: string,
): Logger {
  const log = (level: LogLevel, message: string, details?: unknown) => {
    if (!shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      agentName,
      claimId,
      taskId,
      message,
      details,
    };

    const prefix = [
      `[${entry.timestamp}]`,
      colorize(level, `[${level}]`),
      agentName ? `[${agentName}]` : "",
      claimId ? `[${claimId.slice(0, 8)}]` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const output = details
      ? `${prefix} ${message} ${JSON.stringify(details, null, 2)}`
      : `${prefix} ${message}`;

    if (level === "ERROR") {
      console.error(output);
    } else if (level === "WARN") {
      console.warn(output);
    } else {
      console.log(output);
    }

    if (logCallback) {
      logCallback(entry);
    }
  };

  return {
    debug: (msg, details) => log("DEBUG", msg, details),
    info: (msg, details) => log("INFO", msg, details),
    warn: (msg, details) => log("WARN", msg, details),
    error: (msg, details) => log("ERROR", msg, details),
  };
}

export const logger = createLogger();
