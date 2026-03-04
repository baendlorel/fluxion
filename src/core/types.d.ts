import type http from 'node:http';
import type { InjectionConfig } from '@/common/types.js';
import type { LoggerOption } from '@/common/logger.js';

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

  /**
   * Port listened by primary process for meta APIs.
   * Defaults to `port + 1`.
   */
  metaPort?: number;

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
  metaPort: number;
  injections: InjectionConfig[];
  workerOptions: WorkerOptions;
  maxRequestBytes: number;
  logger: LoggerOption | InjectionConfig;
}

export type FluxionHandler<
  Request extends typeof http.IncomingMessage = typeof http.IncomingMessage,
  Response extends typeof http.ServerResponse = typeof http.ServerResponse,
> = (
  request: InstanceType<Request>,
  response: InstanceType<Response> & { req: InstanceType<Request> },
  normalized: NormalizedRequest,
) => Promise<unknown>;
