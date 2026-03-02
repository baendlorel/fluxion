import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

import { HandlerResult, HttpCode } from '@/common/consts.js';
import { createLogger, getErrorMessage, type LoggerOption } from '@/common/logger.js';
import { createFileRuntime } from '@/workers/file-runtime.js';
import type { ExecutorOptions } from '@/workers/options.js';
import type { protocol } from '@/workers/protocol.js';

import { createMetaApi } from './meta-api.js';

import type { NormalizedRequest } from './types.js';
import { safeSendJson } from './utils/send-json.js';
import { getRealIp } from './utils/headers.js';
import { createBodyPreviewCapture, parseQuery, toURL } from './utils/request.js';

/**
 * Database config item accepted by server options.
 */
export interface FluxionDatabaseConfig {
  /**
   * Stable database name.
   */
  name: string;
}

/**
 * User-provided database config input.
 */
export type FluxionDatabaseInput = string | FluxionDatabaseConfig;

/**
 * Raw database config item loaded from private config file.
 */
export type FluxionDatabaseRuntimeConfigInput =
  | protocol.DataBaseDriver
  | (Record<string, unknown> & {
      driver?: string;
      type?: string;
      contextKey?: string;
      options?: Record<string, unknown>;
    });

export interface InjectionConfig {
  /**
   * Name that you can use to refer to this database in your handlers.
   * It should be unique across all databases and should not contain leading or trailing whitespace.
   * It is recommended to use simple and descriptive names, such as "mainDb" or "redisCache".
   */
  name: string;

  /**
   * Worker will use this to create instance for the injection into context.
   * - You can use it to initialize database connection or any other shared resource that your handlers need.
   * - You should use `const xxx = await import()`
   * - The factory function will be transfer to worker threads by using `.toString()`, so it should not rely on any closure variable or external state. You should put all the necessary code and dependencies inside the factory function itself.
   */
  factory: () => Promise<unknown>;
}

export interface FluxionOptions {
  /**
   * The directory where dynamic files (e.g. uploaded files) will be stored. It will be created if it doesn't exist.
   * It is recommended to use an empty directory that is not used for any other purpose, to avoid potential conflicts or security issues.
   */
  dir: string;

  host: string;

  port: number;

  injections?: InjectionConfig[];

  /**
   * Base worker runtime option overrides.
   */
  workerOptions?: Partial<ExecutorOptions>;

  /**
   * Maximum request body bytes accepted by dynamic handlers.
   * Requests larger than this limit will return 413.
   */
  maxRequestBytes?: number;

  /**
   * Logger output mode or custom logger sink.
   * Defaults to `one-line`.
   */
  logger?: LoggerOption;
}

export function fluxion(options: FluxionOptions): http.Server {
  const dir = path.resolve(options.dir);
  const logger = createLogger(options.logger);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.write('INFO', 'DynamicDirectoryCreated', { directory: dir });
  }

  const fileRuntime = createFileRuntime(dir, {
    workerOptions: options.workerOptions,
    maxRequestBytes: options.maxRequestBytes,
    logger,
  });
  const metaApi = createMetaApi({
    dir,
    getRouteSnapshot: fileRuntime.getRouteSnapshot,
    getWorkerSnapshot: fileRuntime.getWorkerSnapshot,
  });

  void fileRuntime
    .getRouteSnapshot()
    .then((snapshot) => {
      const handlerCount = snapshot.handlers.length;
      const staticFileCount = snapshot.staticFiles.length;

      logger.write('INFO', 'DynamicDirectoryLoaded', {
        dir,
        handlerCount,
        staticFileCount,
      });

      if (handlerCount === 0) {
        logger.write('INFO', 'DynamicHandlersLoaded', { count: 0 });
        return;
      }

      for (let i = 0; i < snapshot.handlers.length; i++) {
        const handler = snapshot.handlers[i];
        logger.write('INFO', 'HandlerLoaded', {
          route: handler.route,
          file: handler.file,
          version: handler.version,
        });
      }
    })
    .catch((error) => {
      logger.write('ERROR', 'DynamicDirectoryLoadFailed', {
        dir,
        error: getErrorMessage(error),
      });
    });

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const ip = getRealIp(req);
    const url = toURL(req.url);
    if (url === undefined) {
      safeSendJson(res, { message: 'Bad Request: req.url is undefined' }, HttpCode.BadRequest);
      return;
    }

    const normalized: NormalizedRequest = {
      method,
      ip,
      url,
      query: parseQuery(url.searchParams),
    };

    const bodyCapture = createBodyPreviewCapture(req);

    logger.write('INFO', 'Req', { method, ip, path: url.pathname });

    const start = performance.now();
    res.once('finish', () => {
      const fields: Record<string, unknown> = {
        method,
        ip,
        path: url.pathname,
        status: res.statusCode,
        duration: (performance.now() - start).toFixed(4),
      };

      if (Object.keys(normalized.query).length > 0) {
        fields.query = normalized.query;
      }

      const bodyPreview = bodyCapture.getPreview();
      if (bodyPreview.exists) {
        fields.body = bodyPreview.value;
        fields.bodyBytes = bodyPreview.bytes;
        fields.bodyTruncated = bodyPreview.truncated;
      }

      logger.write('INFO', 'Res', fields);
    });

    void metaApi
      .handleRequest(req, res, normalized)
      .then(async (metaHandled) => {
        if (metaHandled) {
          return;
        }

        const result = await fileRuntime.handleRequest(req, res, normalized);
        if (result === HandlerResult.NotFound) {
          safeSendJson(res, { message: 'Route not found', method, url }, HttpCode.NotFound);
        }
      })
      .catch((error) => {
        logger.write('ERROR', 'RequestFailed', { method, ip, path: url.pathname, error: getErrorMessage(error) });

        if ((error as NodeJS.ErrnoException).code === 'REQUEST_BODY_TOO_LARGE') {
          safeSendJson(res, { message: getErrorMessage(error) }, HttpCode.PayloadTooLarge);
          return;
        }

        safeSendJson(res, { message: 'Internal Server Error' }, HttpCode.InternalServerError);
      });
  });

  server.on('close', () => {
    void fileRuntime.close();
    logger.write('INFO', 'ServerClosed', {
      host: options.host,
      port: options.port,
    });
  });

  server.listen(options.port, options.host, () => {
    logger.write('INFO', 'ServerStarted', {
      host: options.host,
      port: options.port,
    });
    logger.write('INFO', 'DynamicDirectory', { directory: dir });
  });

  server.on('error', (error) => {
    logger.write('ERROR', 'ServerError', {
      error: getErrorMessage(error),
    });
  });
  return server;
}
