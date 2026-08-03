# Fluxion — AI Coding Instruction

> This document guides AI coding agents (and humans) on how to correctly use the Fluxion framework.
> Fluxion is a filesystem-routing dynamic HTTP server for Node.js, designed as a PHP-like hot-reloadable backend.

## Table of Contents

- [1. Overview](#1-overview)
- [2. Starting a Server](#2-starting-a-server)
- [3. Writing API Handlers](#3-writing-api-handlers)
- [4. Middleware](#4-middleware)
- [5. HTTP Exceptions](#5-http-exceptions)
- [6. Request Object](#6-request-object)
- [7. Response Patterns](#7-response-patterns)
- [8. Options Reference](#8-options-reference)
- [9. Common Patterns & Recipes](#9-common-patterns--recipes)
- [10. Rules & Gotchas](#10-rules--gotchas)

---

## 1. Overview

Fluxion is a Node.js server framework with these core concepts:

- **Filesystem routing**: files under a `dir` directory become HTTP routes. The file path IS the URL path.
- **Lazy loading**: API handler modules are (re)loaded on demand when requests arrive, not via file watchers. There is no file watching at runtime — the server never "stops watching".
- **Single-process architecture**: Fluxion runs as a single process. Use pm2, docker, or kubernetes for clustering and scaling.
- **API handlers**: TypeScript/JavaScript files matching `apiInclude` patterns (default: `**/*.ts`) are loaded as handler modules.
- **Static files**: files matching `staticInclude` patterns (default: `**/*`) are served as static resources (GET/HEAD only).
- **File exclusion**: files matching `exclude` patterns (default: node_modules, .git, dist, etc.) are skipped.
- **Integrated meta APIs**: monitoring endpoints at `/_fluxion/*` for health, version, and route inspection.

### Package Exports

```ts
import {
  fluxion,                          // Start the server
  HttpCode,                         // HTTP status code enum
  defineFluxionModule,              // Define an API handler
  defineFluxionMiddleware,          // Define a middleware
  defineFluxionLogger,              // Define a custom logger
  defineFluxionOptions,             // Normalize/validate options

  // HTTP Exception classes
  HttpException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  MethodNotAllowedException,
  NotAcceptableException,
  RequestTimeoutException,
  ConflictException,
  GoneException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
  TooManyRequestsException,
  InternalServerErrorException,
  NotImplementedException,
  BadGatewayException,
  ServiceUnavailableException,
  GatewayTimeoutException,
} from 'fluxion-ts';
```

---

## 2. Starting a Server

Fluxion is started programmatically. There is no built-in CLI.

```ts
import { fluxion } from 'fluxion-ts';

await fluxion({
  dir: './dynamic',       // Required: directory for route files
  host: '127.0.0.1',      // Required: bind address
  port: 3000,              // Required: HTTP port
});
```

### With environment variables

```ts
import { fluxion } from 'fluxion-ts';

const int = (s: string | undefined, d: number) => {
  const n = Number.parseInt(s ?? '', 10);
  return Number.isNaN(n) ? d : n;
};

await fluxion({
  dir: process.env.DYNAMIC_DIRECTORY ?? './dynamic',
  host: process.env.HOST ?? 'localhost',
  port: int(process.env.PORT, 3000),
  metaApis: ['healthz', 'version', 'stats'],  // Enable monitoring endpoints
  // metaSecret is automatically read from FLUXION_META_SECRET environment variable
  // or set explicitly: metaSecret: 'your-20-char-secret1'
});
```

### With cronjobs enabled

```ts
await fluxion({
  dir: './dynamic',
  host: 'localhost',
  port: 3000,
  cronjobDir: './cronjobs',
});
```

### With HTTPS

```ts
await fluxion({
  dir: './dynamic',
  host: '0.0.0.0',
  port: 443,
  https: {
    key: './certs/private-key.pem',
    cert: './certs/certificate.pem',
    ca: './certs/ca-bundle.crt',   // optional
  },
});
```

### Production deployment with pm2

```bash
# Install pm2
npm install -g pm2

# Start with multiple processes
pm2 start server.ts --name fluxion-app -i max

# View status
pm2 status

# View logs
pm2 logs fluxion-app

# Restart
pm2 restart fluxion-app
```

### Development: install `tsx` for TypeScript hot-reload

```bash
pnpm add -D tsx
```

Then run:

```bash
tsx server.ts
```

---

## 3. Writing API Handlers

Every API handler **must** use `defineFluxionModule()`. Place handler files under the configured `dir`.

### Simple handler (shorthand)

The file path relative to `dir` becomes the URL path. File extension is part of the route.

```ts
// File: dynamic/hello.ts  →  URL: /hello.ts
import { defineFluxionModule } from 'fluxion-ts';

export default defineFluxionModule(async (req, cx) => {
  return { message: 'hello', path: req.url.pathname };
});
```

### Full handler (object form)

```ts
import { defineFluxionModule, defineFluxionMiddleware } from 'fluxion-ts';

const authMiddleware = defineFluxionMiddleware(async (req, cx, rawReq, rawRes) => {
  const token = req.headers.authorization;
  if (!token) {
    rawRes.statusCode = 401;
    rawRes.end('Unauthorized');
    return;
  }
  req.meta.user = { id: 1, name: 'verified-user' };
});

export default defineFluxionModule({
  handler: async (req, cx) => {
    return { user: req.meta.user };
  },
  middlewares: [authMiddleware],
  methods: ['GET', 'POST'],           // Restrict allowed HTTP methods
  handlerTimeoutMs: 10_000,           // Per-handler timeout override
  disposer: async () => {
    // Cleanup when this file is removed or server shuts down
  },
});
```

### Handler signature

```ts
type FluxionHandler = (
  req: NormalizedRequest,        // Parsed request
  cx: FluxionModuleContext,      // { logger }
  rawReq: http.IncomingMessage,  // Node.js raw request
  rawRes: http.ServerResponse,   // Node.js raw response
) => Promise<unknown> | unknown;
```

### Routing table

| File path | URL | Type |
|-----------|-----|------|
| `dynamic/hello.ts` | `/hello.ts` | API handler |
| `dynamic/user/profile.ts` | `/user/profile.ts` | API handler |
| `dynamic/index.html` | `/index.html` | Static file |
| `dynamic/assets/app.js` | `/assets/app.js` | Static file |

---

## 4. Middleware

Middleware runs sequentially **before** the handler. It can modify the request via side effects.

```ts
import { defineFluxionMiddleware } from 'fluxion-ts';

const logMiddleware = defineFluxionMiddleware(async (req, cx) => {
  cx.logger.info({ message: 'request', path: req.url.pathname });
});
```

### Middleware signature

```ts
type FluxionMiddleware = (
  req: NormalizedRequest,
  cx: FluxionModuleContext,
  rawReq: http.IncomingMessage,
  rawRes: http.ServerResponse,
) => Promise<unknown> | unknown;
```

Note: Import types from the package when needed:
```ts
import type { FluxionMiddleware, FluxionModuleContext } from 'fluxion-ts';
import type http from 'node:http';
```

### Stopping the chain

To short-circuit (e.g., auth failure), write directly to `rawRes` and return:

```ts
const authGuard = defineFluxionMiddleware(async (req, cx, rawReq, rawRes) => {
  if (!req.headers.authorization) {
    rawRes.statusCode = 401;
    rawRes.end('Unauthorized');
    return; // handler will NOT be called
  }
});
```

### Timeout

Default middleware timeout is `3000ms`. Configure via `middlewareTimeoutMs` in server options.

---

## 5. Cronjobs

Cronjobs are hot-reloadable scheduled tasks. Enable by setting `cronjobDir` in server options.

### Defining a cronjob

```ts
// File: cronjobs/cleanup.ts
import { defineFluxionCronJob, CronExpressions, FluxionCronJobExecutionStrategy } from 'fluxion-ts';

export default defineFluxionCronJob({
  cronExpression: CronExpressions.EveryHour,
  jobFn: async (cx) => {
    cx.logger.info('Running hourly cleanup');
    // ... cleanup logic
  },
  strategy: FluxionCronJobExecutionStrategy.WaitForCompletion,
});
```

### Cron expression shortcuts

```ts
CronExpressions.EveryMinute        // '* * * * *'
CronExpressions.Every5Minutes      // '*/5 * * * *'
CronExpressions.Every10Minutes     // '*/10 * * * *'
CronExpressions.Every15Minutes     // '*/15 * * * *'
CronExpressions.Every30Minutes     // '*/30 * * * *'
CronExpressions.EveryHour          // '0 * * * *'
CronExpressions.Every2Hours        // '0 */2 * * *'
CronExpressions.Every6Hours        // '0 */6 * * *'
CronExpressions.Every12Hours       // '0 */12 * * *'
CronExpressions.EveryDayAtMidnight // '0 0 * * *'
CronExpressions.EveryDayAtNoon     // '0 12 * * *'
CronExpressions.EveryMonday        // '0 0 * * 1'
CronExpressions.EveryWeek          // '0 0 * * 0'
CronExpressions.EveryMonth         // '0 0 1 * *'
CronExpressions.EveryYear          // '0 0 1 1 *'
```

Or use a custom cron string:

```ts
defineFluxionCronJob({
  cronExpression: '15 2 * * *',  // Every day at 2:15 AM
  jobFn: async (cx) => { /* ... */ },
});
```

### Execution strategies

| Strategy | Behavior |
|----------|----------|
| `FluxionCronJobExecutionStrategy.WaitForCompletion` | Skip this tick if the previous run is still running (default) |
| `FluxionCronJobExecutionStrategy.Immediate` | Fire immediately, even if previous run hasn't finished |

### Lifecycle hooks

```ts
defineFluxionCronJob({
  cronExpression: CronExpressions.EveryHour,
  jobFn: async (cx) => { /* ... */ },
  active: true,                         // Set false to disable without removing
  onRegister: () => { /* file loaded */ },
  onUnregister: () => { /* file removed/changed */ },
});
```

---

## 6. HTTP Exceptions

Throw these in handlers or middleware to produce an error response:

```ts
import { defineFluxionModule, NotFoundException, BadRequestException } from 'fluxion-ts';

export default defineFluxionModule(async (req) => {
  const id = req.query.id;
  if (typeof id !== 'string') {
    throw new BadRequestException('Missing or invalid id parameter');
  }

  const user = await db.findUser(id);
  if (!user) {
    throw new NotFoundException(`User ${id} not found`);
  }

  return { user };
});
```

### Available exceptions

| Class | Status |
|-------|--------|
| `BadRequestException` | 400 |
| `UnauthorizedException` | 401 |
| `ForbiddenException` | 403 |
| `NotFoundException` | 404 |
| `MethodNotAllowedException` | 405 |
| `NotAcceptableException` | 406 |
| `RequestTimeoutException` | 408 |
| `ConflictException` | 409 |
| `GoneException` | 410 |
| `PayloadTooLargeException` | 413 |
| `UnsupportedMediaTypeException` | 415 |
| `UnprocessableEntityException` | 422 |
| `TooManyRequestsException` | 429 |
| `InternalServerErrorException` | 500 |
| `NotImplementedException` | 501 |
| `BadGatewayException` | 502 |
| `ServiceUnavailableException` | 503 |
| `GatewayTimeoutException` | 504 |

---

## 7. Request Object

Every handler and middleware receives a `NormalizedRequest`:

```ts
interface NormalizedRequest {
  method: string;                          // 'GET', 'POST', etc.
  ip: string;                              // Client IP (X-Forwarded-For / X-Real-IP aware)
  url: URL;                                // Parsed URL object
  query: Record<string, string | string[]>;// Query parameters
  body: Record<string, any>;              // Parsed request body
  headers: http.IncomingHttpHeaders;       // Raw headers
  cookie: Record<string, string>;          // Parsed cookies
  meta: Record<any, any>;                 // Custom metadata (mutable, shared across middleware)
}
```

### Body parsing rules

- **GET / HEAD**: body is NOT parsed.
- **JSON** (`Content-Type: application/json`): objects assigned directly; primitives become `{ value: ... }`; invalid JSON becomes `{ raw: '...' }`.
- **Form data** (`multipart/form-data`, `application/x-www-form-urlencoded`): parsed into key/value fields.
- **Text** (`text/*`): stored as `{ raw: '...' }`.
- **Binary**: read for size check; body remains `{}`.

### Query parameters

```ts
// URL: /api.ts?name=foo&tag=a&tag=b
req.query.name  // 'foo'
req.query.tag   // ['a', 'b']
```

### Using `meta` for middleware communication

```ts
const authMiddleware = defineFluxionMiddleware(async (req) => {
  req.meta.userId = 'user-123';  // Write
});

export default defineFluxionModule({
  middlewares: [authMiddleware],
  handler: async (req) => {
    return { userId: req.meta.userId };  // Read
  },
});
```

---

## 8. Response Patterns

### Return value → JSON response

Returning a value automatically produces a `200 OK` JSON response:

```ts
export default defineFluxionModule(async () => {
  return { ok: true, data: [1, 2, 3] };
});
// → HTTP 200, Content-Type: application/json
// → {"ok":true,"data":[1,2,3]}
```

### Manual response via rawRes

Write directly to `rawRes` for custom status codes, headers, or streaming:

```ts
export default defineFluxionModule(async (_req, _cx, _rawReq, res) => {
  res.statusCode = 201;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('created');
});
```

### Rules

- If `rawRes` has already ended (`res.writableEnded`), Fluxion will NOT send another response.
- If the handler returns `undefined` and the response hasn't been ended, Fluxion sends the default JSON.
- If `rawRes.headersSent` is true, Fluxion just calls `res.end()` to flush.

---

## 9. Options Reference

```ts
interface FluxionOptions {
  // Required
  dir: string;                    // Dynamic directory path
  host: string;                   // Bind address
  port: number;                   // HTTP port (1–65535)

  // Timeouts
  handlerTimeoutMs?: number;       // Default: 5000
  middlewareTimeoutMs?: number;    // Default: 3000
  staticResourceTimeoutMs?: number; // Default: 600000 (10 min)

  // File watching
  reloadDelay?: number;            // Debounce delay, default: 500ms
  nativeWatcher?: boolean;         // Use fs.watch instead of chokidar

  // File patterns
  apiInclude?: string[];           // API handler patterns. Default: ['**/*.ts']
  staticInclude?: string[];        // Static resource patterns. Default: ['**/*']
  exclude?: string[];              // Exclude patterns (overrides defaults)
  apiMapper?: string | function;  // Transform API file paths to routes. Default: 'remove-ext'

  // Meta API
  metaApis?: ('healthz' | 'version' | 'routes' | 'stats' | 'config')[];  // Default: ['healthz', 'version', 'stats']
  metaSecret?: string;             // Required for all meta APIs: ≥20 chars, letters+digits, no whitespace. Defaults to FLUXION_META_SECRET env var

  // Request limits
  maxRequestBytes?: number;        // Default: 8_000_000 (8MB). 413 if exceeded.

  // Logging
  logger?: 'one-line' | 'json-line' | FluxionLoggerFn;

  // Module system
  moduleDir?: string;              // Base for relative paths. Default: process.cwd()

  // HTTPS
  https?: {
    key: string | Buffer;
    cert: string | Buffer;
    ca?: string | Buffer | Array<string | Buffer>;
  };

  // Cronjobs
  cronjobDir?: string;             // Cronjob directory (undefined = disabled)
  cronjobInclude?: string[];       // Default: ['**/*.ts']
  cronjobExclude?: string[];       // Default: []
}
```

---

## 10. Common Patterns & Recipes

### REST-style API with method routing

```ts
export default defineFluxionModule({
  methods: ['GET', 'POST', 'DELETE'],
  handler: async (req) => {
    switch (req.method) {
      case 'GET':    return await listItems();
      case 'POST':   return await createItem(req.body);
      case 'DELETE': return await deleteItem(req.query.id as string);
      default:       throw new MethodNotAllowedException();
    }
  },
});
```

### JSON body validation

```ts
import { defineFluxionModule, BadRequestException } from 'fluxion-ts';

export default defineFluxionModule({
  methods: ['POST'],
  handler: async (req) => {
    const { name, email } = req.body;
    if (!name || typeof name !== 'string') {
      throw new BadRequestException('name is required and must be a string');
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new BadRequestException('valid email is required');
    }
    return { created: true, name, email };
  },
});
```

### Composing multiple middleware

```ts
import { defineFluxionModule, defineFluxionMiddleware } from 'fluxion-ts';

const cors = defineFluxionMiddleware(async (_req, _cx, _rawReq, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
});

const rateLimit = defineFluxionMiddleware(async (req) => {
  // ... rate limit logic using req.ip
});

export default defineFluxionModule({
  middlewares: [cors, rateLimit],
  handler: async (req) => {
    return { ok: true };
  },
});
```

### Custom logger

```ts
import { fluxion, defineFluxionLogger } from 'fluxion-ts';

const myLogger = defineFluxionLogger((entry) => {
  // entry: { timestamp, level, ...fields }
  console.log(JSON.stringify(entry));
});

await fluxion({
  dir: './dynamic',
  host: 'localhost',
  port: 3000,
  logger: myLogger,
});
```

### Static files alongside APIs

```ts
await fluxion({
  dir: './public',
  host: 'localhost',
  port: 3000,
  apiInclude: ['**/*.ts'],       // .ts files are API handlers
  staticInclude: ['**/*'],      // All files are static resources
  exclude: ['**/*.test.ts'],     // Exclude test files
  apiMapper: 'remove-ext',      // Remove extensions from API routes (default)
});
```

Files like `public/index.html` become static routes at `/index.html`.
Files like `public/api/users.ts` become API routes at `/api/users` (extension removed by default).

### API Path Mapping

The `apiMapper` option controls how API file paths are transformed into URL routes. Static resources are not affected by this setting.

#### Preset Options

```ts
// Remove file extensions (default)
apiMapper: 'remove-ext'
// user/profile.ts → /user/profile

// Keep paths unchanged
apiMapper: 'identical'
// user/profile.ts → /user/profile.ts
```

#### Custom Mapping Function

Provide your own transformation function for complete control:

```ts
apiMapper: (path) => {
  // Custom transformation logic
  return path
    .replace(/\.ts$/, '')              // Remove extension
    .replace(/^api\//, '/api/v1/')     // Add version prefix
    .replace(/\/index$/, '/');          // Clean up /index/ paths
}
// api/users/index.ts → /api/v1/users
// api/posts.ts → /api/v1/posts
```

#### Examples

```ts
// RESTful API with version prefix
await fluxion({
  apiMapper: (path) => `/api/v1/${path.replace(/\.ts$/, '')}`,
  // routes/users.ts → /api/v1/routes/users
});

// Clean URLs without nested paths
await fluxion({
  apiMapper: (path) => path.replace(/\//g, '-').replace(/\.ts$/, ''),
  // user/profile.ts → user-profile
});

// Domain-based routing
await fluxion({
  apiMapper: (path) => {
    const [domain, ...rest] = path.split('/');
    return `/${domain}/api/${rest.join('/').replace(/\.ts$/, '')}`;
  },
  // admin/users.ts → /admin/api/users
  // public/products.ts → /public/api/products
});
```

---

## 11. Rules & Gotchas

### DO

- ✅ **Always use `defineFluxionModule()`** for API handlers. Raw exports will be rejected.
- ✅ **Always use `defineFluxionMiddleware()`** for middleware functions.
- ✅ **Use `req.meta`** to pass data between middleware and handler.
- ✅ **Throw HTTP exceptions** (e.g., `NotFoundException`) for error responses.
- ✅ **Check `rawRes.writableEnded`** before writing to raw response if middleware might have ended it.
- ✅ **Use `disposer`** for cleanup (database connections, file handles, timers).
- ✅ **Restrict `methods`** when an endpoint should only accept specific HTTP methods.
- ✅ **Install `tsx`** for TypeScript hot-reload in development.

### DON'T

- ❌ **Don't export handler directly** without `defineFluxionModule()`:
  ```ts
  // WRONG — will be rejected at load time
  export default async (req) => { return { ok: true }; };
  ```
- ❌ **Don't use `console.log`** in handlers — use `cx.logger` for structured, timestamped logs.
- ❌ **Don't store state in handler modules** — files are hot-reloaded, so module-level state is lost on file change. Use external stores (Redis, database, etc.).
- ❌ **Don't use `GET`/`HEAD` for body-dependent logic** — body is not parsed for these methods.
- ❌ **Don't forget file extension in URL** — `/hello.ts` not `/hello`. The extension IS part of the route.
- ❌ **Don't set `metaSecret`** to less than 20 characters or without both letters and digits — it will throw.
- ❌ **Don't share cronjob files with API handlers** — they live in separate directories (`dir` vs `cronjobDir`).

### File extension behavior in routes

By default, API routes have file extensions removed (controlled by `apiMapper` option).

```
// With apiMapper: 'remove-ext' (default)
dynamic/hello.ts        → GET /hello
dynamic/api/users.ts    → GET /api/users

// With apiMapper: 'identical'
dynamic/hello.ts        → GET /hello.ts
dynamic/api/users.ts    → GET /api/users.ts
```

Static files always keep their extensions:
```
dynamic/index.html      → GET /index.html
dynamic/assets/app.js   → GET /assets/app.js
```

### Module state is ephemeral

When a file changes, the module is reloaded. Any module-level variables (caches, counters, connections) are reset. Design handlers to be stateless.

### Process management

Fluxion runs as a single process. For production deployments, use process managers like pm2, docker, or kubernetes for clustering and load balancing.

### Meta API endpoints

Meta APIs are integrated into the main server at `/_fluxion/*` endpoints (configurable via `metaApis` option).

**Security:** Basic monitoring endpoints are publicly accessible. Sensitive endpoints require secret authentication.

```http
GET /_fluxion/healthz              # Health check ✅ Public (default: enabled)
GET /_fluxion/version              # Version information ✅ Public (default: enabled)
GET /_fluxion/stats                # Memory/CPU/runtime stats ✅ Public (default: enabled)
GET /_fluxion/config?secret=<key>  # Current configuration 🔒 Requires secret (default: disabled)
GET /_fluxion/routes?secret=<key>  # Route table snapshot 🔒 Requires secret (default: disabled)
```

**Authentication:**
```bash
# Basic monitoring - no authentication required
curl http://127.0.0.1:3000/_fluxion/healthz
curl http://127.0.0.1:3000/_fluxion/version
curl http://127.0.0.1:3000/_fluxion/stats

# Set secret for sensitive endpoints
export FLUXION_META_SECRET='your-20-char-secret1'

# Or configure explicitly
await fluxion({
  metaSecret: 'your-20-char-secret1',  // Optional: falls back to FLUXION_META_SECRET
});

# Access sensitive endpoints with secret
curl 'http://127.0.0.1:3000/_fluxion/routes?secret=your-20-char-secret1'
curl 'http://127.0.0.1:3000/_fluxion/config?secret=your-20-char-secret1'
```

## Recent Updates

### v1.0.0 (Current Major Release)

**Architecture Simplification**
- 🔄 Removed cluster mode - now single-process for simplicity
- ✨ Meta APIs integrated into main server at `/_fluxion/*` endpoints
- ✨ Configurable meta API endpoints via `metaApis` option
- ✨ Use pm2/docker/kubernetes for process management and clustering
- 🔒 Enhanced security - all meta API endpoints require secret authentication
- 🔄 Removed `workerOptions`, `metaPort` options

**Benefits**
- Simpler architecture and maintenance
- Better integration with standard deployment tools
- Flexible process management
- Reduced framework complexity
- Improved security with unified authentication

**Migration Guide**
- Remove `workerOptions` and `metaPort` from configuration
- Set `FLUXION_META_SECRET` environment variable for meta API access
- Update meta API calls from `metaPort` to main port with `/_fluxion/*` prefix
- All meta API endpoints now require `?secret=` parameter
- Use pm2/docker/kubernetes for clustering instead of built-in cluster mode

### v0.16.5

**API Path Mapping**
- ✨ Added `apiMapper` option to control how API file paths are transformed into URL routes
- ✨ Support for custom mapping functions
- ✨ Preset options: `'remove-ext'` (default) and `'identical'`
- 🔄 Changed default behavior to remove file extensions from API routes

**Logging Enhancements**
- ✨ Core-level logging for framework internals (router, watcher, etc.)
- ✨ Timestamp format changed to ISO 8601 standard
- ✨ Version information now displayed on startup

**Type Safety**
- ✨ Enhanced type definitions for better IDE support
- ✨ Improved module validation with clearer error messages
