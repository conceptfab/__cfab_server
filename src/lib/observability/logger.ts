import type { AppEnv } from "@/lib/config/env";
import { getEnv } from "@/lib/config/env";

type LogLevel = AppEnv["logLevel"];

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  [key: string]: unknown;
}

function shouldLog(current: LogLevel, desired: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[desired] >= LOG_LEVEL_PRIORITY[current];
}

function writeLine(level: LogLevel, payload: Record<string, unknown>): void {
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  if (level === "debug") {
    console.debug(line);
    return;
  }
  console.info(line);
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const env = getEnv();
  if (!shouldLog(env.logLevel, level)) {
    return;
  }

  writeLine(level, {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
}

export function logError(event: string, error: unknown, fields: LogFields = {}): void {
  const normalized =
    error instanceof Error
      ? {
          errorName: error.name,
          errorMessage: error.message,
        }
      : {
          errorName: "UnknownError",
          errorMessage: String(error),
        };

  log("error", event, { ...fields, ...normalized });
}

