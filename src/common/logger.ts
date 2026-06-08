import type { otherstring, InjectionConfig } from '@/common/types.js';
import type { FluxionContext } from '@/core/types.js';

import { dtm } from './dtm.js';
import { $keys, $stringify } from './native.js';
import { loadFunction } from './injector.js';
import { cctl } from './color.js';

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
  INFO: `${cctl.cyan}INFO${cctl.reset}`,
  WARN: `${cctl.orange}WARN${cctl.reset}`,
  ERROR: `${cctl.red}ERROR${cctl.reset}`,
  SUCC: `${cctl.green}SUCC${cctl.reset}`,
  DEBUG: `${cctl.blue}DEBUG${cctl.reset}`,
  VERBOSE: `${cctl.purple}VERBOSE${cctl.reset}`,
};
const TimestampColor = 'rgb(22, 101, 52)';

export const oneLineLogger: LoggerSink = (entry: LogEntry) => {
  const { level: rawLevel, timestamp: rawTimestamp, event: rawEvent, message: rawMessage, ...fields } = entry;

  const timestamp = `${cctl.darkGreen}[${rawTimestamp}]${cctl.reset}`;
  const level = ColoredLevels[rawLevel] ?? rawLevel;
  const body = rawMessage ?? rawEvent;
  const fieldsText = $keys(fields).length > 0 ? `${cctl.dim}${safeStringify(fields)}${cctl.reset}` : '';

  console.log(`${timestamp} ${level} ${body}${fieldsText}`);
};

/**
 * & Logger Options here is checked by normalizeOptions function.
 */
function resolveLoggerSink(cx: Pick<FluxionContext, 'options'>): LoggerSink {
  const loggerOption = cx.options.logger;
  if (loggerOption === undefined || loggerOption === 'one-line') {
    return oneLineLogger;
  }

  if (loggerOption === 'json-line') {
    return (entry: LogEntry) => console.log(safeStringify(entry));
  }

  return loadFunction(loggerOption) as LoggerSink;
}

export function createLogger(cx: Pick<FluxionContext, 'options'>): FluxionLogger {
  const sink = resolveLoggerSink(cx);

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
export const getErrorMessage = (error: unknown): string =>
  typeof error === 'object' && error !== null ? (error as any).message : String(error);
