import type { FluxionContext } from '@/types.js';
import type { otherstring } from '@/global.js';
import stringify from 'fast-json-stable-stringify';

import { dtm } from './dtm.js';
import { cctl } from './color.js';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCC' | 'DEBUG' | 'VERBOSE' | otherstring;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  [key: string]: unknown;
}

export type LoggerOption = 'one-line' | 'json-line' | FluxionLoggerFn;

export type FluxionLoggerFn = (entry: LogEntry) => void;

export interface FluxionLogger {
  /**
   * [WARN] We assert that `fields` is an object or undefined.
   */
  write(level: LogLevel, messageOrObject: string | object): void;
  info(messageOrObject: string | object): void;
  warn(messageOrObject: string | object): void;
  error(messageOrObject: string | object): void;
  succ(messageOrObject: string | object): void;
  debug(messageOrObject: string | object): void;
  verbose(messageOrObject: string | object): void;
}

const safeStringify = (value: unknown): string => {
  try {
    return stringify(value);
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
  const fieldsText = Object.keys(fields).length > 0 ? `${cctl.dim}${safeStringify(fields)}${cctl.reset}` : '';

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
    write(level: LogLevel, o: string | object): void {
      const entry: LogEntry =
        typeof o === 'string'
          ? {
              message: o,
              timestamp: dtm(),
              level,
            }
          : {
              ...o,
              timestamp: dtm(),
              level,
            };

      try {
        sink(entry);
      } catch {
        // Ignore logger sink failures to avoid breaking request handling.
      }
    },
    info(messageOrObject: string | object): void {
      this.write('INFO', messageOrObject);
    },
    warn(messageOrObject: string | object): void {
      this.write('WARN', messageOrObject);
    },
    error(messageOrObject: string | object): void {
      this.write('ERROR', messageOrObject);
    },
    succ(messageOrObject: string | object): void {
      this.write('SUCC', messageOrObject);
    },
    debug(messageOrObject: string | object): void {
      this.write('DEBUG', messageOrObject);
    },
    verbose(messageOrObject: string | object): void {
      this.write('VERBOSE', messageOrObject);
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
    write(level: LogLevel, messageOrObject: string | object): void {
      baseLogger.write(level, `${pidPrefix} ${stringify(messageOrObject)}`);
    },
    info(messageOrObject: string | object): void {
      baseLogger.info(`${pidPrefix} ${stringify(messageOrObject)}`);
    },
    warn(messageOrObject: string | object): void {
      baseLogger.warn(`${pidPrefix} ${stringify(messageOrObject)}`);
    },
    error(messageOrObject: string | object): void {
      baseLogger.error(`${pidPrefix} ${stringify(messageOrObject)}`);
    },
    succ(messageOrObject: string | object): void {
      baseLogger.succ(`${pidPrefix} ${stringify(messageOrObject)}`);
    },
    debug(messageOrObject: string | object): void {
      baseLogger.debug(`${pidPrefix} ${stringify(messageOrObject)}`);
    },
    verbose(messageOrObject: string | object): void {
      baseLogger.verbose(`${pidPrefix} ${stringify(messageOrObject)}`);
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
