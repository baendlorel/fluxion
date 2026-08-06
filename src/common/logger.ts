import type { FluxionContext } from '@/types.js';
import type { otherstring } from '@/global.js';
import stringify from 'fast-json-stable-stringify';
import { createWriteStream, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

import { cctl } from './color.js';

type LogLevel = 'CORE' | 'INFO' | 'WARN' | 'ERROR' | 'SUCC' | 'DEBUG' | 'VERBOSE' | otherstring;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  [key: string]: unknown;
}

export type LoggerOption = 'one-line' | 'json-line' | FluxionLoggerFn;

export type FluxionLoggerFn = (entry: LogEntry) => void;

export interface MessageObject {
  [key: string]: unknown;
  message?: string;
}

export interface FluxionLogger {
  /**
   * [WARN] We assert that `fields` is an object or undefined.
   */
  write(level: LogLevel, messageOrObject: string | MessageObject): void;
  info(messageOrObject: string | MessageObject): void;
  warn(messageOrObject: string | MessageObject): void;
  error(messageOrObject: string | MessageObject): void;
  succ(messageOrObject: string | MessageObject): void;
  debug(messageOrObject: string | MessageObject): void;
  verbose(messageOrObject: string | MessageObject): void;
}

/**
 * Internal-only logger used by fluxion's own subsystems (router, injector,
 * ...). It extends the public {@link FluxionLogger}
 * with a `core` level that records framework-originated logs — e.g. route
 * registration, module lifecycle — so they are visually distinct
 * from logs emitted by user handlers.
 *
 * ! This type is NOT exported to application code: {@link FluxionModuleContext}
 * exposes only {@link FluxionLogger}, keeping
 * `core` off-limits to user handlers.
 */
export interface InternalFluxionLogger extends FluxionLogger {
  core(messageOrObject: string | MessageObject): void;
}

const safeStringify = (value: unknown): string => {
  try {
    return stringify(value);
  } catch {
    return '[unserializable]';
  }
};

const ColoredLevels: Record<LogLevel, string> = {
  CORE: `${cctl.brightBlack}CORE${cctl.reset}`,
  INFO: `${cctl.cyan}INFO${cctl.reset}`,
  WARN: `${cctl.orange}WARN${cctl.reset}`,
  ERROR: `${cctl.red}ERROR${cctl.reset}`,
  SUCC: `${cctl.green}SUCC${cctl.reset}`,
  DEBUG: `${cctl.blue}DEBUG${cctl.reset}`,
  VERBOSE: `${cctl.purple}VERBOSE${cctl.reset}`,
};

export const oneLineLogger: FluxionLoggerFn = (entry: LogEntry) => {
  const { level: rawLevel, timestamp: rawTimestamp, message: rawMessage, pid, ...fields } = entry;

  const timestamp = `${cctl.darkGreen}[${rawTimestamp}]${cctl.reset}`;
  const level = ColoredLevels[rawLevel] ?? rawLevel;
  const pidText = pid === undefined ? '' : ` [${pid}]`;
  const fieldsText = Object.keys(fields).length > 0 ? ` ${cctl.dim}${safeStringify(fields)}${cctl.reset}` : '';

  // 智能处理消息内容：如果有 message 字段就显示，否则只显示 fields
  const content = rawMessage ? rawMessage + fieldsText : fieldsText.trim();

  // eslint-disable-next-line @typescript-eslint/no-console
  console.log(`${timestamp} ${level}${pidText} ${content}`);
};

/**
 * 创建文件日志写入器
 */
function createFileSink(logFilePath: string): (entry: LogEntry) => void {
  // 确保日志目录存在
  if (!existsSync(logFilePath)) {
    const dir = dirname(logFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const fileStream = createWriteStream(logFilePath, { flags: 'a' });

  return (entry: LogEntry) => {
    try {
      const timestamp = entry.timestamp || new Date().toISOString();
      const level = entry.level || 'INFO';
      const pid = entry.pid !== undefined ? ` [${entry.pid}]` : '';
      const message = entry.message ? entry.message : safeStringify(entry);

      fileStream.write(`[${timestamp}] ${level}${pid} ${message}\n`);
    } catch {
      // 忽略文件写入错误
    }
  };
}

/**
 * & Logger Options here is checked by normalizeOptions function.
 */
function resolveLoggerSink(cx: Pick<FluxionContext, 'options'>): FluxionLoggerFn {
  // 检查是否设置了 FLUXION_INSTANCE_LOG 环境变量
  const instanceLogPath = process.env.FLUXION_INSTANCE_LOG;
  const fileSink = instanceLogPath ? createFileSink(instanceLogPath) : null;

  const loggerOption = cx.options.logger;
  if (loggerOption === undefined || loggerOption === 'one-line') {
    if (fileSink) {
      // 同时输出到控制台和文件
      return (entry: LogEntry) => {
        oneLineLogger(entry);
        fileSink(entry);
      };
    }
    return oneLineLogger;
  }

  if (loggerOption === 'json-line') {
    // eslint-disable-next-line @typescript-eslint/no-console
    const jsonSink = (entry: LogEntry) => console.log(safeStringify(entry));
    if (fileSink) {
      return (entry: LogEntry) => {
        jsonSink(entry);
        fileSink(entry);
      };
    }
    return jsonSink;
  }

  if (fileSink) {
    // 自定义 logger + 文件输出
    return (entry: LogEntry) => {
      loggerOption(entry);
      fileSink(entry);
    };
  }

  return loggerOption;
}

export function createLogger(cx: Pick<FluxionContext, 'options'>): InternalFluxionLogger {
  const sink = resolveLoggerSink(cx);

  const logger: InternalFluxionLogger = {
    write(level: LogLevel, o: string | object): void {
      const entry: LogEntry =
        typeof o === 'string'
          ? {
              message: o,
              timestamp: new Date().toISOString(),
              level,
            }
          : {
              ...o,
              timestamp: new Date().toISOString(),
              level,
            };

      try {
        sink(entry);
      } catch {
        // Ignore logger sink failures to avoid breaking request handling.
      }
    },
    info(messageOrObject: string | MessageObject): void {
      this.write('INFO', messageOrObject);
    },
    warn(messageOrObject: string | MessageObject): void {
      this.write('WARN', messageOrObject);
    },
    error(messageOrObject: string | MessageObject): void {
      this.write('ERROR', messageOrObject);
    },
    succ(messageOrObject: string | MessageObject): void {
      this.write('SUCC', messageOrObject);
    },
    debug(messageOrObject: string | MessageObject): void {
      this.write('DEBUG', messageOrObject);
    },
    verbose(messageOrObject: string | MessageObject): void {
      this.write('VERBOSE', messageOrObject);
    },
    core(messageOrObject: string | MessageObject): void {
      this.write('CORE', messageOrObject);
    },
  };

  return logger;
}

/**
 * Create a worker logger that prefixes all log messages with the worker PID.
 */
export function createWorkerLogger(baseLogger: FluxionLogger, pid: number): InternalFluxionLogger {
  return {
    write(level: LogLevel, messageOrObject: string | MessageObject): void {
      baseLogger.write(
        level,
        typeof messageOrObject === 'string' ? { message: messageOrObject, pid } : { ...messageOrObject, pid },
      );
    },
    info(messageOrObject: string | MessageObject): void {
      this.write('INFO', messageOrObject);
    },
    warn(messageOrObject: string | MessageObject): void {
      this.write('WARN', messageOrObject);
    },
    error(messageOrObject: string | MessageObject): void {
      this.write('ERROR', messageOrObject);
    },
    succ(messageOrObject: string | MessageObject): void {
      this.write('SUCC', messageOrObject);
    },
    debug(messageOrObject: string | MessageObject): void {
      this.write('DEBUG', messageOrObject);
    },
    verbose(messageOrObject: string | MessageObject): void {
      this.write('VERBOSE', messageOrObject);
    },
    core(messageOrObject: string | MessageObject): void {
      this.write('CORE', messageOrObject);
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
