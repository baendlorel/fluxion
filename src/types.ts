import type http from 'node:http';
import type { FluxionLogger, InternalFluxionLogger, LoggerOption } from '@/common/logger.js';
import type { FluxionRouter } from './router/index.js';
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
   * Meta API endpoints to enable. Each endpoint corresponds to a /_fluxion/<name> route.
   * Available endpoints: 'healthz', 'version', 'stats', 'config'
   * Defaults to ['healthz', 'version', 'stats']
   *
   * Endpoint descriptions:
   * - healthz: Basic health check (no authentication required)
   * - version: Version information (no authentication required)
   * - stats: Memory, CPU, and runtime statistics (no authentication required)
   * - config: Current configuration (requires secret authentication)
   */
  metaApis?: ('healthz' | 'version' | 'stats' | 'config')[];

  /**
   * Secret for protecting sensitive meta API endpoints.
   *
   * **Authentication:** Only 'config' endpoint requires secret authentication via `?secret=` parameter.
   * Basic monitoring endpoints ('healthz', 'version', 'stats') are publicly accessible.
   *
   * **Priority:** Explicit `metaSecret` option > `FLUXION_META_SECRET` environment variable.
   *
   * **Validation:** Must be at least 20 characters, include both letters and digits, and contain no whitespace.
   *
   * **Defaults:** Reads from `FLUXION_META_SECRET` environment variable if not explicitly set.
   *
   * **Disabled:** When set to `undefined` or doesn't meet validation rules, 'routes' and 'config' endpoints are disabled.
   */
  metaSecret?: string;
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
  moduleDir: string;
  maxRequestBytes: number;
  logger: LoggerOption;
  apiInclude: string[];
  staticInclude: string[];
  exclude: string[];
  metaApis: ('healthz' | 'version' | 'stats' | 'config')[];
  metaSecret?: string;
  https?: {
    key: string | Buffer;
    cert: string | Buffer;
    ca?: string | Buffer | Array<string | Buffer>;
  };

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
  router: FluxionRouter;
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

export type NormalizedModule = FluxionModule & {
  absolutePath: string;

  /**
   * mtime from `fs.stat`
   */
  mtimeMs: number;

  type: FluxionModuleType;
};
