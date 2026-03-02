import chalk from 'chalk';
import { dtm } from './dtm.js';
import { $keys, $stringify } from './native.js';
import { otherstring } from '@/global.js';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCC' | 'DEBUG' | 'VERBOSE' | otherstring;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  message?: string;
  [key: string]: unknown;
}

type LoggerSink = (entry: LogEntry) => void;

export type LoggerOption = 'one-line' | 'json-line' | LoggerSink;

export interface FluxionLogger {
  /**
   * [WARN] We assert that `fields` is an object or undefined.
   */
  write(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  succ(event: string, fields?: Record<string, unknown>): void;
  debug(event: string, fields?: Record<string, unknown>): void;
  verbose(event: string, fields?: Record<string, unknown>): void;
}

const safeStringify = (value: unknown): string => {
  try {
    return $stringify(value);
  } catch {
    return '[unserializable]';
  }
};

const omitReservedFields = (entry: LogEntry): Record<string, unknown> => {
  const fields: Record<string, unknown> = { ...entry };
  delete fields.timestamp;
  delete fields.level;
  delete fields.event;
  delete fields.message;
  return fields;
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

function resolveLoggerSink(option: LoggerOption | undefined): LoggerSink {
  if (option === 'json-line') {
    return (entry: LogEntry) => console.log(safeStringify(entry));
  }

  if (option === undefined || option === 'one-line') {
    return (entry: LogEntry) => {
      const fields = omitReservedFields(entry);
      const timestamp = TimestampColor(`[${entry.timestamp}]`);
      const level = ColoredLevels[entry.level] ?? entry.level;
      const body = entry.message ?? entry.event;
      const fieldsText = $keys(fields).length > 0 ? ` ${chalk.dim(safeStringify(fields))}` : '';
      console.log(`${timestamp} ${level} ${body}${fieldsText}`);
    };
  }

  if (typeof option === 'function') {
    return option;
  }

  throw new Error('Invalid logger option: expected function | "one-line" | "json-line"');
}

export function createLogger(option: LoggerOption | undefined = 'one-line'): FluxionLogger {
  const sink = resolveLoggerSink(option);

  return {
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
}

/**
 * ! Error.isError needs Node.js 24
 */
export const getErrorMessage = (error: unknown): string => (Error.isError(error) ? error.message : String(error));
