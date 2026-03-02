import type http from 'node:http';

import type { HandlerResult } from '@/common/consts.js';
import type { FluxionLogger } from '@/common/logger.js';
import type { InjectionConfig, NormalizedRequest } from '@/core/types.js';
import type { HandlerWorkerPool, HandlerWorkerSnapshot } from '@/workers/handler-worker-pool.js';
import type { ExecutorOptions } from '@/workers/options.js';

/**
 * Parsed and validated request path.
 */
export interface ParsedPath {
  /**
   * Original pathname.
   */
  pathname: string;

  /**
   * Safe decoded path segments.
   */
  segments: string[];
}

/**
 * Resolved dynamic handler file.
 */
export interface ResolvedHandlerFile {
  /**
   * Absolute handler path.
   */
  filePath: string;

  /**
   * Current handler version token.
   */
  version: string;
}

/**
 * Common route snapshot fields.
 */
interface RouteEntryBase {
  /**
   * Relative file path.
   */
  file: string;

  /**
   * Version token derived from file metadata.
   */
  version: string;
}

/**
 * Dynamic route snapshot row.
 */
export interface HandlerRouteEntry extends RouteEntryBase {
  /**
   * Public route path.
   */
  route: string;
}

/**
 * Static route snapshot row.
 */
export interface StaticRouteEntry extends RouteEntryBase {
  /**
   * Public route path.
   */
  route: string;
}

/**
 * Full route snapshot used by meta api.
 */
export interface FileRouteSnapshot {
  /**
   * Dynamic handler routes.
   */
  handlers: HandlerRouteEntry[];

  /**
   * Static file routes.
   */
  staticFiles: StaticRouteEntry[];
}

/**
 * Worker runtime snapshot used by meta api.
 */
export interface FileWorkerSnapshot {
  /**
   * Dynamic directory absolute path.
   */
  dir: string;

  /**
   * Worker supervisor snapshots.
   */
  workers: HandlerWorkerSnapshot[];
}

/**
 * Optional file runtime configuration.
 */
export interface FileRuntimeOptions {
  /**
   * Injections to be applied to `context` of all workers.
   */
  injections?: InjectionConfig[];

  /**
   * Base runtime option overrides applied to worker pools.
   */
  workerOptions?: Partial<ExecutorOptions>;

  /**
   * Maximum request body bytes accepted by dynamic handlers.
   */
  maxRequestBytes?: number;

  /**
   * Runtime logger implementation.
   */
  logger?: FluxionLogger;
}

/**
 * File runtime public contract.
 */
export interface FileRuntime {
  /**
   * Clears runtime caches.
   */
  clearCache(): void;

  /**
   * Closes runtime resources.
   */
  close(): Promise<void>;

  /**
   * Builds route snapshot from filesystem.
   */
  getRouteSnapshot(): Promise<FileRouteSnapshot>;

  /**
   * Returns worker diagnostics snapshot.
   */
  getWorkerSnapshot(): FileWorkerSnapshot;

  /**
   * Handles request by dynamic handler or static file fallback.
   */
  handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    normalized?: NormalizedRequest,
  ): Promise<HandlerResult>;
}

/**
 * Runtime worker binding used for routing.
 */
export interface WorkerBinding {
  /**
   * Stable worker id.
   */
  id: string;

  /**
   * Worker pool handle.
   */
  pool: HandlerWorkerPool;
}
