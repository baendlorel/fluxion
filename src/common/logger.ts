import chalk from 'chalk';
import { dtm } from './dtm.js';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCC';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  message?: string;
  [key: string]: unknown;
}

export type LoggerMode = 'one-line' | 'json-line';
export type LoggerSink = (entry: LogEntry) => void;
export type LoggerOption = LoggerMode | LoggerSink;

export interface FluxionLogger {
  write(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function omitReservedFields(entry: LogEntry): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const keys = Object.keys(entry);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === 'timestamp' || key === 'level' || key === 'event' || key === 'message') {
      continue;
    }

    fields[key] = entry[key];
  }

  return fields;
}

function writeOneLine(entry: LogEntry): void {
  const fields = omitReservedFields(entry);
  const hasFields = Object.keys(fields).length > 0;
  const timestampText = chalk.dim(`[${entry.timestamp}]`);
  const levelText = formatLevel(entry.level);
  const body = entry.message ?? entry.event;
  const bodyText = entry.message !== undefined ? chalk.white(body) : chalk.bold.white(body);
  const fieldsText = hasFields ? ` ${chalk.dim(safeStringify(fields))}` : '';

  console.log(`${timestampText} ${levelText} ${bodyText}${fieldsText}`);
}

function writeJsonLine(entry: LogEntry): void {
  console.log(safeStringify(entry));
}

export function resolveLoggerSink(option: LoggerOption | undefined): LoggerSink {
  if (option === undefined || option === 'one-line') {
    return writeOneLine;
  }

  if (option === 'json-line') {
    return writeJsonLine;
  }

  if (typeof option === 'function') {
    return option;
  }

  throw new Error('Invalid logger option: expected function | "one-line" | "json-line"');
}

function formatLevel(level: LogLevel): string {
  const label = `[${level}]`;

  switch (level) {
    case 'INFO':
      return chalk.bold.hex('#38bdf8')(label);
    case 'WARN':
      return chalk.bold.hex('#fb923c')(label);
    case 'ERROR':
      return chalk.bold.hex('#ef4444')(label);
    case 'SUCC':
      return chalk.bold.hex('#22c55e')(label);
    default:
      return chalk.bold(label);
  }
}

export function createLogger(option: LoggerOption | undefined = 'one-line'): FluxionLogger {
  const sink = resolveLoggerSink(option);

  return {
    write(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
      const entry: LogEntry = {
        timestamp: dtm(),
        level,
        event,
      };

      const keys = Object.keys(fields);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];

        if (key === 'timestamp' || key === 'level' || key === 'event') {
          continue;
        }

        entry[key] = fields[key];
      }

      try {
        sink(entry);
      } catch {
        // Ignore logger sink failures to avoid breaking request handling.
      }
    },
  };
}

export function getErrorMessage(error: unknown): string {
  // ! Error.isError needs Node.js 24
  return Error.isError(error) ? error.message : String(error);
}

const defaultLogger = createLogger('one-line');

/**
 * Compatibility helper for existing call sites. Prefer `createLogger().write`.
 */
export function logJsonl(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  defaultLogger.write(level, event, fields);
}

/**
 * Compatibility helper for existing call sites. Prefer structured events.
 */
export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  defaultLogger.write(level, 'Message', { message, ...fields });
}
