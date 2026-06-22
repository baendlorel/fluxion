import type http from 'node:http';
import type { FluxionLogger, LoggerOption } from '@/common/logger.js';
import type { FluxionRouter } from './router/index.js';
import type { FluxionChokidarWatcher } from './watcher/chokidar.ts';
import type { FluxionNativeWatcher } from './watcher/native.ts';
import type { otherstring } from './global.js';

export interface NormalizedRequest {
  /**
   * HTTP request method (GET, POST, PUT, DELETE, etc.)
   */
  method: string;

  /**
   * Client IP address (supports X-Forwarded-For and X-Real-IP headers)
   */
  ip: string;

  /**
   * Parsed request URL
   */
  url: URL;

  /**
   * Parsed query parameters from URL search string
   */
  query: Record<string, string | string[]>;

  /**
   * Parsed request body (JSON, form data, etc.)
   */
  body: Record<string, any>;

  /**
   * Raw HTTP request headers
   */
  headers: http.IncomingHttpHeaders;

  /**
   * Parsed cookies from the Cookie header
   */
  cookie: Record<string, string>;
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
   * Default to 5000ms.
   */
  handlerTimeoutMs?: number;

  /**
   * Delay in milliseconds for reloading handlers after file changes are detected.
   *
   * Defaults to 500ms.
   */
  reloadDelay?: number;

  /**
   * Port listened by primary process for meta APIs.
   * Defaults to `port + 1`.
   */
  metaPort?: number;

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

  /**
   * Glob patterns for files that should be registered.
   * Only files matching these patterns will be registered (as API or static resource).
   * Defaults to all files (via wildcard patterns).
   * @example ['*.ts', '*.js'] - only register TypeScript and JavaScript files
   */
  include?: string[];

  /**
   * Glob patterns for files that should be registered as API handlers.
   * Files matching these patterns will be loaded as handlers and registered as APIs.
   * Defaults to TypeScript files (*.ts).
   * @example ['*.api.ts', 'handlers/*.js'] - register specific patterns as APIs
   */
  apiInclude?: string[];

  /**
   * Glob patterns for files that should be excluded from registration.
   * Files matching these patterns will not be registered (neither as API nor static resource).
   * Defaults to common exclusions like node_modules, .git, dist, etc.
   */
  exclude?: string[];

  /**
   * HTTPS server configuration. If provided, the server will use HTTPS instead of HTTP.
   * Both `key` and `cert` are required for HTTPS. `ca` is optional for certificate chains.
   */
  https?: {
    /**
     * Path to the private key file (PEM format) or the key content as a string/buffer.
     */
    key: string | Buffer;
    /**
     * Path to the certificate file (PEM format) or the certificate content as a string/buffer.
     */
    cert: string | Buffer;
    /**
     * Optional: Path to CA certificate file(s) or the CA content as a string/buffer/array.
     * Used for intermediate certificates.
     */
    ca?: string | Buffer | Array<string | Buffer>;
  };

  /**
   * Use native file watcher (fs.watch) instead of chokidar.
   * When set to true, uses the native Node.js fs.watch() for file watching.
   * Defaults to false (uses chokidar for better cross-platform compatibility).
   */
  nativeWatcher?: boolean;
}

export interface NormalizedFluxionOptions {
  /**
   * It's absolute path to the directory where dynamic files will be stored.
   */
  dir: string;
  host: string;
  port: number;
  handlerTimeoutMs: number;
  reloadDelay: number;
  metaPort: number;
  moduleDir: string;
  workerOptions: WorkerOptions;
  maxRequestBytes: number;
  logger: LoggerOption;
  include: string[];
  apiInclude: string[];
  exclude: string[];
  nativeWatcher: boolean;
  https?: {
    key: string | Buffer;
    cert: string | Buffer;
    ca?: string | Buffer | Array<string | Buffer>;
  };
}

export interface FluxionContext {
  options: NormalizedFluxionOptions;
  logger: FluxionLogger;
  watcher: FluxionChokidarWatcher | FluxionNativeWatcher;
  router: FluxionRouter;
}

export type FluxionHandler<
  Request extends typeof http.IncomingMessage = typeof http.IncomingMessage,
  Response extends typeof http.ServerResponse = typeof http.ServerResponse,
> = (
  request: NormalizedRequest,
  rawRequest: InstanceType<Request>,
  rawResponse: InstanceType<Response> & { req: InstanceType<Request> },
) => Promise<unknown> | unknown;

export type FluxionDispose = () => Promise<void> | void;

/**
 * Supported HTTP methods for FluxionModule
 */
export type HTTPMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'HEAD'
  | 'OPTIONS'
  | 'TRACE'
  | 'CONNECT'
  | otherstring;

export interface FluxionModule {
  /**
   * Main handler for an api
   */
  handler: FluxionHandler;

  /**
   * This is meant to clear resources used by handler while it's down.
   */
  disposer?: FluxionDispose;

  /**
   * How many ms to wait until the request times out
   */
  handlerTimeoutMs?: number;

  /**
   * Allowed HTTP methods for this module.
   * If specified, only these methods will be accepted.
   * @example ['GET', 'POST']
   */
  methods?: HTTPMethod[];
}
