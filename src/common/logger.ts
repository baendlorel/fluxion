import type { FluxionContext } from '@/types.js';
import type { otherstring } from '@/global.js';

import { dtm } from './dtm.js';
import { $keys, $stringify } from './native.js';
import { cctl } from './color.js';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCC' | 'DEBUG' | 'VERBOSE' | otherstring;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

export type LoggerOption = 'one-line' | 'json-line' | FluxionLoggerFn;

export type FluxionLoggerFn = (entry: LogEntry) => void;

export interface FluxionLogger {
  /**
   * [WARN] We assert that `fields` is an object or undefined.
   */
  write(level: LogLevel, message: string, fields?: object): void;
  info(message: string, fields?: object): void;
  warn(message: string, fields?: object): void;
  error(message: string, fields?: object): void;
  succ(message: string, fields?: object): void;
  debug(message: string, fields?: object): void;
  verbose(message: string, fields?: object): void;
}

const safeStringify = (value: unknown): string => {
  try {
    return $stringify(value);
  } catch {
    return '[unserializable]';
  }
};

const ColoredLevels: Record<LogLevel, string> = {
  INFO: `${cctl.cyan}INFO${cctl.reset}`,
  WARN: `${cctl.orange}WARN${cctl.reset}`,
  ERROR: `${cctl.red}ERROR${cctl.reset}`,
  SUCC: `${cctl.green}SUCC${cctl.reset}`,
  DEBUG: `${cctl.blue}DEBUG${cctl.reset}`,
  VERBOSE: `${cctl.purple}VERBOSE${cctl.reset}`,
};

export const oneLineLogger: FluxionLoggerFn = (entry: LogEntry) => {
  const { level: rawLevel, timestamp: rawTimestamp, message: rawMessage, ...fields } = entry;

  const timestamp = `${cctl.darkGreen}[${rawTimestamp}]${cctl.reset}`;
  const level = ColoredLevels[rawLevel] ?? rawLevel;
  const body = rawMessage;
  const fieldsText = $keys(fields).length > 0 ? `${cctl.dim}${safeStringify(fields)}${cctl.reset}` : '';

  // eslint-disable-next-line @typescript-eslint/no-console
  console.log(`${timestamp} ${level} ${body}${fieldsText}`);
};

/**
 * & Logger Options here is checked by normalizeOptions function.
 */
function resolveLoggerSink(cx: Pick<FluxionContext, 'options'>): FluxionLoggerFn {
  const loggerOption = cx.options.logger;
  if (loggerOption === undefined || loggerOption === 'one-line') {
    return oneLineLogger;
  }

  if (loggerOption === 'json-line') {
    // eslint-disable-next-line @typescript-eslint/no-console
    return (entry: LogEntry) => console.log(safeStringify(entry));
  }

  return loggerOption;
}

export function createLogger(cx: Pick<FluxionContext, 'options'>): FluxionLogger {
  const sink = resolveLoggerSink(cx);

  const logger: FluxionLogger = {
    write(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
      const entry: LogEntry = {
        ...fields,
        timestamp: dtm(),
        level,
        message,
      };

      try {
        sink(entry);
      } catch {
        // Ignore logger sink failures to avoid breaking request handling.
      }
    },
    info(message: string, fields?: Record<string, unknown>): void {
      this.write('INFO', message, fields);
    },
    warn(message: string, fields?: Record<string, unknown>): void {
      this.write('WARN', message, fields);
    },
    error(message: string, fields?: Record<string, unknown>): void {
      this.write('ERROR', message, fields);
    },
    succ(message: string, fields?: Record<string, unknown>): void {
      this.write('SUCC', message, fields);
    },
    debug(message: string, fields?: Record<string, unknown>): void {
      this.write('DEBUG', message, fields);
    },
    verbose(message: string, fields?: Record<string, unknown>): void {
      this.write('VERBOSE', message, fields);
    },
  };

  return logger;
}

/**
 * Create a worker logger that prefixes all log messages with the worker PID.
 */
export function createWorkerLogger(baseLogger: FluxionLogger, pid: number): FluxionLogger {
  const pidPrefix = `[${pid}]`;

  return {
    write(level: LogLevel, message: string, fields?: object): void {
      baseLogger.write(level, `${pidPrefix} ${message}`, fields);
    },
    info(message: string, fields?: object): void {
      baseLogger.info(`${pidPrefix} ${message}`, fields);
    },
    warn(message: string, fields?: object): void {
      baseLogger.warn(`${pidPrefix} ${message}`, fields);
    },
    error(message: string, fields?: object): void {
      baseLogger.error(`${pidPrefix} ${message}`, fields);
    },
    succ(message: string, fields?: object): void {
      baseLogger.succ(`${pidPrefix} ${message}`, fields);
    },
    debug(message: string, fields?: object): void {
      baseLogger.debug(`${pidPrefix} ${message}`, fields);
    },
    verbose(message: string, fields?: object): void {
      baseLogger.verbose(`${pidPrefix} ${message}`, fields);
    },
  };
}

/**
 * ! Error.isError needs Node.js 24
 */
export const getErrorMessage =
  typeof Error.isError === 'function'
    ? (e: unknown): string => (Error.isError(e) ? e.message : String(e))
    : (e: unknown): string => (e as any)?.message || String(e);
