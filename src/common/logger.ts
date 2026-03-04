import chalk from 'chalk';
import type { otherstring, InjectionConfig } from '@/global.js';

import { dtm } from './dtm.js';
import { $keys, $stringify } from './native.js';
import { loadFunction } from './injector.js';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCC' | 'DEBUG' | 'VERBOSE' | otherstring;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  message?: string;
  [key: string]: unknown;
}

type LoggerSink = (entry: LogEntry) => void;

export type LoggerOption = 'one-line' | 'json-line' | InjectionConfig;

export interface FluxionLogger {
  /**
   * [WARN] We assert that `fields` is an object or undefined.
   */
  write(level: LogLevel, event: string, fields?: object): void;
  info(event: string, fields?: object): void;
  warn(event: string, fields?: object): void;
  error(event: string, fields?: object): void;
  succ(event: string, fields?: object): void;
  debug(event: string, fields?: object): void;
  verbose(event: string, fields?: object): void;
}

const safeStringify = (value: unknown): string => {
  try {
    return $stringify(value);
  } catch {
    return '[unserializable]';
  }
};

const ColoredLevels: Record<LogLevel, string> = {
  INFO: chalk.hex('#0386e3')('INFO'),
  WARN: chalk.hex('#fb923c')('WARN'),
  ERROR: chalk.hex('#ef4444')('ERROR'),
  SUCC: chalk.hex('#22c55e')('SUCC'),
  DEBUG: chalk.hex('#d327e0')('DEBUG'),
  VERBOSE: chalk.hex('#36ffeb')('SUCC'),
};
const TimestampColor = chalk.hex('#166534');

export const oneLineLogger: LoggerSink = (entry: LogEntry) => {
  const { level: rawLevel, timestamp: rawTimestamp, event: rawEvent, message: rawMessage, ...fields } = entry;

  const timestamp = TimestampColor(`[${rawTimestamp}]`);
  const level = ColoredLevels[rawLevel] ?? rawLevel;
  const body = rawMessage ?? rawEvent;
  const fieldsText = $keys(fields).length > 0 ? ` ${chalk.dim(safeStringify(fields))}` : '';

  console.log(`${timestamp} ${level} ${body}${fieldsText}`);
};

/**
 * & Logger Options here is checked by normalizeOptions function.
 */
async function resolveLoggerSink(option: LoggerOption | undefined): Promise<LoggerSink> {
  if (option === undefined || option === 'one-line') {
    return oneLineLogger;
  }

  if (option === 'json-line') {
    return (entry: LogEntry) => console.log(safeStringify(entry));
  }

  return loadFunction(option) as Promise<LoggerSink>;
}

export async function createLogger(option: LoggerOption | undefined = 'one-line'): Promise<FluxionLogger> {
  const sink = await resolveLoggerSink(option);

  const logger: FluxionLogger = {
    write(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
      const entry: LogEntry = {
        ...fields,
        timestamp: dtm(),
        level,
        event,
      };

      try {
        sink(entry);
      } catch {
        // Ignore logger sink failures to avoid breaking request handling.
      }
    },
    info(event: string, fields?: Record<string, unknown>): void {
      this.write('INFO', event, fields);
    },
    warn(event: string, fields?: Record<string, unknown>): void {
      this.write('WARN', event, fields);
    },
    error(event: string, fields?: Record<string, unknown>): void {
      this.write('ERROR', event, fields);
    },
    succ(event: string, fields?: Record<string, unknown>): void {
      this.write('SUCC', event, fields);
    },
    debug(event: string, fields?: Record<string, unknown>): void {
      this.write('DEBUG', event, fields);
    },
    verbose(event: string, fields?: Record<string, unknown>): void {
      this.write('VERBOSE', event, fields);
    },
  };

  return logger;
}

/**
 * ! Error.isError needs Node.js 24
 */
export const getErrorMessage = (error: unknown): string => (Error.isError(error) ? error.message : String(error));
