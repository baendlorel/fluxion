import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

import { HandlerResult, HttpCode } from '@/common/consts.js';
import { createLogger, getErrorMessage, type LoggerOption } from '@/common/logger.js';
import { createFileRuntime } from '@/workers/file-runtime.js';
import type { ExecutorOptions, WorkerStrategy } from '@/workers/options.js';
import type { protocol } from '@/workers/protocol.js';

import { createMetaApi } from './meta-api.js';

import type { NormalizedRequest } from './types.js';
import { safeSendJson } from './utils/send-json.js';
import { getRealIp } from './utils/headers.js';
import { createBodyPreviewCapture, parseQuery, toURL } from './utils/request.js';

const nodeRequire = createRequire(import.meta.url);

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
  | protocol.DbDriver
  | (Record<string, unknown> & {
      driver?: string;
      type?: string;
      contextKey?: string;
      options?: Record<string, unknown>;
    });

export interface FluxionOptions {
  /**
   * The directory where dynamic files (e.g. uploaded files) will be stored. It will be created if it doesn't exist.
   * It is recommended to use an empty directory that is not used for any other purpose, to avoid potential conflicts or security issues.
   */
  dir: string;

  host: string;

  port: number;

  /**
   * Declared database names used by worker strategy routing.
   */
  databases?: FluxionDatabaseInput[];

  /**
   * Optional path to private db config file.
   * Defaults to `./.fluxion-private/db.config.cjs`.
   */
  dbConfigPath?: string;

  /**
   * Worker routing strategy.
   */
  workerStrategy?: WorkerStrategy;

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

/**
 * Runtime guard for plain object values.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Normalizes db driver aliases to runtime-supported values.
 */
function normalizeDbDriver(input: string, source: string, dbName: string): protocol.DbDriver {
  const normalized = input.trim().toLowerCase();

  if (normalized === 'pg' || normalized === 'postgres' || normalized === 'postgresql') {
    return 'pg';
  }

  if (normalized === 'mysql2' || normalized === 'mysql') {
    return 'mysql2';
  }

  throw new Error(`Unsupported db driver "${input}" for "${dbName}" in ${source}`);
}

/**
 * Normalizes one raw db config item.
 */
function normalizeDatabaseRuntimeConfigItem(
  dbName: string,
  input: FluxionDatabaseRuntimeConfigInput,
  source: string,
): protocol.WorkerDbConnectionConfig {
  if (typeof input === 'string') {
    return {
      driver: normalizeDbDriver(input, source, dbName),
      options: {},
    };
  }

  const rawDriver =
    typeof input.driver === 'string' ? input.driver : typeof input.type === 'string' ? input.type : undefined;

  if (rawDriver === undefined) {
    throw new Error(`Missing db driver for "${dbName}" in ${source}`);
  }

  const rawContextKey = typeof input.contextKey === 'string' ? input.contextKey.trim() : undefined;
  const contextKey = rawContextKey === undefined || rawContextKey.length === 0 ? undefined : rawContextKey;

  const options: Record<string, unknown> = {};

  if (input.options !== undefined) {
    if (!isRecord(input.options)) {
      throw new Error(`Invalid db options for "${dbName}" in ${source}: options must be an object`);
    }

    const optionKeys = Object.keys(input.options);
    for (let i = 0; i < optionKeys.length; i++) {
      const key = optionKeys[i];
      const value = input.options[key];
      if (value !== undefined) {
        options[key] = value;
      }
    }
  } else {
    const keys = Object.keys(input);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === 'driver' || key === 'type' || key === 'options') {
        continue;
      }

      const value = input[key];
      if (value !== undefined) {
        options[key] = value;
      }
    }
  }

  return {
    driver: normalizeDbDriver(rawDriver, source, dbName),
    contextKey,
    options,
  };
}

/**
 * Normalizes private db config file exports.
 */
function normalizeDatabaseConfigMap(input: unknown, source: string): protocol.WorkerDbConfigMap {
  if (input === undefined || input === null) {
    return {};
  }

  if (!isRecord(input)) {
    throw new Error(`Invalid db config file "${source}": expected object export`);
  }

  const normalized: protocol.WorkerDbConfigMap = {};
  const rawNames = Object.keys(input);

  for (let i = 0; i < rawNames.length; i++) {
    const rawName = rawNames[i];
    const name = rawName.trim();

    if (name.length === 0) {
      throw new Error(`Invalid db config in "${source}": empty database name`);
    }

    const rawConfig = input[rawName];
    if (typeof rawConfig !== 'string' && !isRecord(rawConfig)) {
      throw new Error(`Invalid db config for "${name}" in "${source}"`);
    }

    normalized[name] = normalizeDatabaseRuntimeConfigItem(name, rawConfig as FluxionDatabaseRuntimeConfigInput, source);
  }

  return normalized;
}

/**
 * Resolves private db config path.
 */
function resolveDbConfigPath(input: string | undefined): string {
  return path.resolve(input ?? path.join('.fluxion-private', 'db.config.cjs'));
}

/**
 * Loads db config module from private file.
 */
function loadDatabaseConfigMapFromFile(filePath: string): protocol.WorkerDbConfigMap {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const requiredModule = nodeRequire(filePath) as unknown;
  const exported = isRecord(requiredModule) && 'default' in requiredModule ? requiredModule.default : requiredModule;
  return normalizeDatabaseConfigMap(exported, filePath);
}

/**
 * Normalizes database names with private config fallback.
 */
function normalizeDatabaseNames(
  databases: FluxionDatabaseInput[] | undefined,
  fallbackNames: readonly string[],
): string[] {
  if (databases === undefined || databases.length === 0) {
    const names = [...fallbackNames];
    names.sort((left, right) => left.localeCompare(right));
    return names;
  }

  const names: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < databases.length; i++) {
    const item = databases[i];
    const rawName = typeof item === 'string' ? item : item.name;
    const name = rawName.trim();

    if (name.length === 0) {
      throw new Error(`Invalid databases[${i}]: empty name`);
    }

    if (seen.has(name)) {
      throw new Error(`Duplicate database name: ${name}`);
    }

    seen.add(name);
    names.push(name);
  }

  return names;
}

/**
 * Selects declared db configs for worker bootstrap.
 */
function selectDeclaredDatabaseConfigMap(
  databaseNames: readonly string[],
  databaseConfigMap: protocol.WorkerDbConfigMap,
): protocol.WorkerDbConfigMap {
  const selected: protocol.WorkerDbConfigMap = {};

  for (let i = 0; i < databaseNames.length; i++) {
    const name = databaseNames[i];
    const config = databaseConfigMap[name];
    if (config !== undefined) {
      selected[name] = config;
    }
  }

  return selected;
}

export function fluxion(options: FluxionOptions): http.Server {
  const dir = path.resolve(options.dir);
  const dbConfigPath = resolveDbConfigPath(options.dbConfigPath);
  const loadedDatabaseConfigMap = loadDatabaseConfigMapFromFile(dbConfigPath);
  const databaseNames = normalizeDatabaseNames(options.databases, Object.keys(loadedDatabaseConfigMap));
  const databaseConfigMap = selectDeclaredDatabaseConfigMap(databaseNames, loadedDatabaseConfigMap);
  const logger = createLogger(options.logger);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.write('INFO', 'DynamicDirectoryCreated', { directory: dir });
  }

  const fileRuntime = createFileRuntime(dir, {
    databaseNames,
    databaseConfigMap,
    workerStrategy: options.workerStrategy,
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
