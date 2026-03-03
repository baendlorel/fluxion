import type http from 'node:http';
import type { FluxionLogger, LoggerOption } from '@/common/logger.ts';

export interface NormalizedRequest {
  method: string;
  ip: string;
  url: URL;
  query: Record<string, string | string[]>;
  body: Record<string, any>;
}

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

/**
 * Worker runtime tuning options.
 */
export interface WorkerOptions {
  maxWorkerCount: number;

  /**
   * Request timeout in milliseconds.
   */
  requestTimeoutMs: number;

  /**
   * Maximum concurrent requests allowed in the pool.
   */
  maxInflight: number;

  /**
   * Soft heap threshold in MB. Idle worker may restart after crossing it.
   */
  memorySoftLimitMb: number;

  /**
   * ! Hard heap threshold in MB. Worker is restarted once reached.
   */
  memoryHardLimitMb: number;

  /**
   * Memory telemetry interval in milliseconds.
   */
  memorySampleIntervalMs: number;

  /**
   * ! V8 old-generation limit per worker in MB.
   */
  maxOldGenerationSizeMb: number;

  /**
   * ! V8 young-generation limit per worker in MB.
   */
  maxYoungGenerationSizeMb: number;

  /**
   * Worker stack size in MB.
   */
  stackSizeMb: number;

  /**
   * ! Maximum response payload bytes allowed from worker to main thread.
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

  injections?: InjectionConfig[];

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
  injections: InjectionConfig[];
  workerOptions: WorkerOptions;
  maxRequestBytes: number;
  logger: FluxionLogger;
}

export type FluxionHandler<
  Request extends typeof http.IncomingMessage = typeof http.IncomingMessage,
  Response extends typeof http.ServerResponse = typeof http.ServerResponse,
> = (
  request: InstanceType<Request>,
  response: InstanceType<Response> & { req: InstanceType<Request> },
  normalized: NormalizedRequest,
) => Promise<unknown>;
