import { dtm } from './dtm.js';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface OneLineLogEntry {
  level?: LogLevel;
  message: string;
  fields?: Record<string, unknown>;
}

/**
 * Write a jsonl log entry to stdout. The log entry will include a timestamp, log level, event name, and any additional fields provided.
 */
export function logJsonl(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      timestamp: dtm(),
      level,
      event,
      ...fields,
    }),
  );
}

export function log(level: LogLevel, message: string): void {
  console.log(`[${dtm()}] ${level} - ${message}`);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
