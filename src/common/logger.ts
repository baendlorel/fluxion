import { dtm } from './dtm.js';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface OneLineLogEntry {
  level?: LogLevel;
  message: string;
  fields?: Record<string, unknown>;
}

export function logJsonLine(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      timestamp: dtm(),
      level,
      event,
      ...fields,
    }),
  );
}

export function logOneLine(level: LogLevel, message: string): void {
  console.log(`[${dtm()}] ${level} - ${message}`);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
