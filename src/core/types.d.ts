import type http from 'node:http';
import type { InjectionConfig } from '@/common/types.js';
import type { FluxionLogger, LoggerOption } from '@/common/logger.js';
import type { FluxionRouter } from './router.ts';
import type { FluxionWatcher } from './watch.ts';

export interface NormalizedRequest {
  method: string;
  ip: string;
  url: URL;
  query: Record<string, string | string[]>;
  body: Record<string, any>;
}

/**
 * Worker runtime tuning options.
 */
export interface WorkerOptions {
  /**
   * Maximum number of worker processes to spawn.
   * @default 4
   */
  maxWorkerCount: number;

  /**
   * Request timeout in milliseconds.
   * @default 3000
   */
  requestTimeoutMs: number;

  /**
   * Maximum concurrent requests allowed in the pool.
   * @default 64
   */
  maxInflight: number;

  /**
   * Soft heap threshold in MB. Idle worker may restart after crossing it.
   * @default 96
   */
  memorySoftLimitMb: number;

  /**
   * ! Hard heap threshold in MB. Worker is restarted once reached.
   * @default 128
   */
  memoryHardLimitMb: number;

  /**
   * Memory telemetry interval in milliseconds.
   * @default 5000
   */
  memorySampleIntervalMs: number;

  /**
   * ! V8 old-generation limit per worker in MB.
   * @default 128
   */
  maxOldGenerationSizeMb: number;

  /**
   * ! V8 young-generation limit per worker in MB.
   * @default 32
   */
  maxYoungGenerationSizeMb: number;

  /**
   * Worker stack size in MB.
   * @default 4
   */
  stackSizeMb: number;

  /**
   * ! Maximum response payload bytes allowed from worker to main thread.
   * @default 2097152 (2MB)
   */
  maxResponseBytes: number;
}

export interface FluxionOptions {
  /**
   * The directory where dynamic files (e.g. uploaded files) will be stored. It will be created if it doesn't exist.
   * It is recommended to use an empty directory that is not used for any other purpose, to avoid potential conflicts or security issues.
   */
  dir: string;

  host: string;

  port: number;

  /**
   * Delay in milliseconds for reloading handlers after file changes are detected.
   *
   * Defaults to 300ms.
   */
  reloadDelay?: number;

  /**
   * Port listened by primary process for meta APIs.
   * Defaults to `port + 1`.
   */
  metaPort?: number;

  /**
   * Injections will be injected into `globalThis[Symbol.for('fluxion-injections')]`;
   * - **name**: Name that you can use to refer to this injected dependency in your handlers.
   * - **modulePath**: The `.mjs` path that exports the factory function to create the dependency instance.
   */
  injections?: InjectionConfig[];

  /**
   * Inject Path that will be used like `path.join(moduleDir,modulepath)`
   * - default is `process.cwd()`
   */
  moduleDir?: string;

  /**
   * Base worker runtime option overrides.
   */
  workerOptions?: Partial<WorkerOptions>;

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

export interface NormalizedFluxionOptions {
  dir: string;
  host: string;
  port: number;
  reloadDelay: number;
  metaPort: number;
  injections: InjectionConfig[];
  moduleDir: string;
  workerOptions: WorkerOptions;
  maxRequestBytes: number;
  logger: LoggerOption | InjectionConfig;
}

export interface FluxionContext {
  options: NormalizedFluxionOptions;
  logger: FluxionLogger;
  watcher: FluxionWatcher;
  router: FluxionRouter;
}

export type FluxionHandler<
  Request extends typeof http.IncomingMessage = typeof http.IncomingMessage,
  Response extends typeof http.ServerResponse = typeof http.ServerResponse,
> = (
  request: NormalizedRequest,
  rawRequest: InstanceType<Request>,
  rawResponse: InstanceType<Response> & { req: InstanceType<Request> },
) => Promise<unknown>;
