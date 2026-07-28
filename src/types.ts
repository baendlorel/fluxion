import type http from 'node:http';
import type { FluxionLogger, InternalFluxionLogger, LoggerOption } from '@/common/logger.js';
import type { FluxionRouter } from './router/index.js';
import type { ApiWatcher } from './watcher/api-watcher.js';
import type { otherstring } from './global.js';
import type { FluxionModuleType } from './common/consts.js';

export interface FluxionRequest {
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

  meta: Record<any, any>;
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
   * Timeout for each middleware execution.
   * Default to 3000ms.
   */
  middlewareTimeoutMs?: number;

  /**
   * Default to 10 minutes 10*60*1000ms.
   */
  staticResourceTimeoutMs?: number;

  /**
   * Delay in milliseconds for reloading handlers after file changes are detected.
   *
   * Defaults to 500ms.
   */
  reloadDelay?: number;

  /**
   * Inject Path that will be used like `path.join(moduleDir,modulepath)`
   * - default is `process.cwd()`
   */
  moduleDir?: string;

  /**
   * Maximum request body bytes accepted by dynamic handlers.
   * Requests larger than this limit will return 413.
   */
  maxRequestBytes?: number;

  /**
   * Logger output mode or custom logger sink.
   * Defaults to `one-line`.
   *
   * Also accepts a logger function that will replace the default one.
   *
   * ! **ATTENTION** Fluxion calls the logging function synchronously and fails silently; make sure to handle exceptions yourself.
   */
  logger?: LoggerOption;

  /**
   * Glob patterns for files that should be registered as API handlers.
   * Files matching these patterns will be loaded as handlers and registered as APIs.
   * Defaults to TypeScript files (*.ts).
   * @example ['*.api.ts', 'handlers/*.js'] - register specific patterns as APIs
   */
  apiInclude?: string[];

  /**
   * Glob patterns for files that should be registered as static resources.
   * Files(after matching `apiInclude`) matching these patterns will be served as static files.
   * Defaults to all files if not provided.
   * @example ['*.html', '*.css', '*.js'] - serve specific patterns as static files
   */
  staticInclude?: string[];

  /**
   * Glob patterns for files that should be excluded from registration.
   * Files matching these patterns will not be registered (neither as API nor static resource).
   * Defaults to common exclusions like node_modules, .git, dist, etc.
   */
  exclude?: string[];

  /**
   * Function or preset to map API file paths to URL routes.
   *
   * Controls how API file paths are transformed into URL routes. Static resources are not affected.
   *
   * - `"remove-ext"` (default): Remove file extensions from API routes.
   *   Example: `user/profile.ts` → `/user/profile`
   * - `"identical"`: Keep file paths unchanged.
   *   Example: `user/profile.ts` → `/user/profile.ts`
   * - Custom function: Provide your own mapping function.
   *   Example: `(path) => path.replace(/\.ts$/, '').replace(/^api\//, '/api/v1/')`
   *
   * @default "remove-ext"
   */
  apiMapper?: 'remove-ext' | 'identical' | ((relativePath: string) => string);

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

  /**
   * Meta API endpoints to enable. Each endpoint corresponds to a /_fluxion/<name> route.
   * Available endpoints: 'healthz', 'version', 'routes'
   * Defaults to ['healthz', 'version', 'routes'] (all enabled)
   */
  metaApis?: ('healthz' | 'version' | 'routes')[];

  /**
   * Secret for enabling the routes meta API.
   *
   * **Enable Condition:** Only strings with at least 20 characters, both letters and digits, and no whitespace enable `GET /_fluxion/routes?secret=...`.
   *
   * Defaults to `undefined`, which disables this API even if 'routes' is in metaApis.
   */
  metaSecret?: string;

  /**
   * Directory containing cronjob files. When set, cronjobs will be loaded from this directory.
   * Set to undefined to disable cronjob support.
   * @default undefined
   */
  cronjobDir?: string;

  /**
   * Glob patterns for cronjob files that should be registered.
   * @default ['**\/*.ts']
   */
  cronjobInclude?: string[];

  /**
   * Glob patterns for cronjob files that should be excluded.
   * @default []
   */
  cronjobExclude?: string[];
}

export interface NormalizedFluxionOptions {
  /**
   * It's absolute path to the directory where dynamic files will be stored.
   */
  dir: string;
  host: string;
  port: number;
  handlerTimeoutMs: number;
  middlewareTimeoutMs: number;
  staticResourceTimeoutMs: number;
  reloadDelay: number;
  moduleDir: string;
  maxRequestBytes: number;
  logger: LoggerOption;
  apiInclude: string[];
  staticInclude: string[];
  exclude: string[];
  apiMapper: (relativePath: string) => string;
  nativeWatcher: boolean;
  metaApis: ('healthz' | 'version' | 'routes')[];
  metaSecret?: string;
  https?: {
    key: string | Buffer;
    cert: string | Buffer;
    ca?: string | Buffer | Array<string | Buffer>;
  };

  /** Absolute path to cronjob directory, or undefined if cronjob is disabled. */
  cronjobDir?: string;
  cronjobInclude: string[];
  cronjobExclude: string[];

  // !security check
  normalizedFlag: symbol;
}

export interface FluxionRouteMeta {
  path: string;
  type: 'api' | 'static';
  methods: HTTPMethod[] | null;
}

export interface FluxionContext {
  options: NormalizedFluxionOptions;
  logger: InternalFluxionLogger;
  watcher: ApiWatcher;
  router: FluxionRouter;
  cronjobManager?: import('./cronjob/manager.js').FluxionCronJobManager;
}

export interface FluxionModuleContext {
  logger: FluxionLogger;
}

export type FluxionHandler<
  Request extends typeof http.IncomingMessage = typeof http.IncomingMessage,
  Response extends typeof http.ServerResponse = typeof http.ServerResponse,
> = (
  request: FluxionRequest,
  cx: FluxionModuleContext,
  rawRequest: InstanceType<Request>,
  rawResponse: InstanceType<Response> & { req: InstanceType<Request> },
) => Promise<unknown> | unknown;

export type FluxionMiddleware<
  Request extends typeof http.IncomingMessage = typeof http.IncomingMessage,
  Response extends typeof http.ServerResponse = typeof http.ServerResponse,
> = (
  request: FluxionRequest,
  cx: FluxionModuleContext,
  rawRequest: InstanceType<Request>,
  rawResponse: InstanceType<Response>,
) => Promise<unknown> | unknown;

export type FluxionDisposer = () => Promise<void> | void;

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
  disposer?: FluxionDisposer;

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

  /**
   * These functions will execute sequentially and be awaited.
   *
   * **Side Effect Accepted :** You can modify the arguments, and next middleware will use the modified version.
   */
  middlewares?: FluxionMiddleware[];
}

export type FluxionModuleWithType = FluxionModule & { type: FluxionModuleType };
