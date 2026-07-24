# Fluxion — AI Coding Instruction

> This document guides AI coding agents (and humans) on how to correctly use the Fluxion framework.
> Fluxion is a filesystem-routing dynamic HTTP server for Node.js, designed as a PHP-like hot-reloadable backend.

## Table of Contents

- [1. Overview](#1-overview)
- [2. Starting a Server](#2-starting-a-server)
- [3. Writing API Handlers](#3-writing-api-handlers)
- [4. Middleware](#4-middleware)
- [5. Cronjobs](#5-cronjobs)
- [6. HTTP Exceptions](#6-http-exceptions)
- [7. Request Object](#7-request-object)
- [8. Response Patterns](#8-response-patterns)
- [9. Options Reference](#9-options-reference)
- [10. Common Patterns & Recipes](#10-common-patterns--recipes)
- [11. Rules & Gotchas](#11-rules--gotchas)

---

## 1. Overview

Fluxion is a Node.js server framework with these core concepts:

- **Filesystem routing**: files under a `dir` directory become HTTP routes. The file path IS the URL path.
- **Hot reload**: files are watched via `chokidar` (or native `fs.watch`); changes are picked up automatically without restart.
- **Cluster mode**: a primary process manages worker processes. Workers serve traffic; primary manages lifecycle and meta APIs.
- **API handlers**: TypeScript/JavaScript files matching `apiInclude` patterns (default: `**/*.ts`) are loaded as handler modules.
- **Static files**: non-API files are served as static resources (GET/HEAD only).
- **Cronjobs**: optional hot-reloadable scheduled tasks via `cronjobDir`.

### Package Exports

```ts
import {
  fluxion,                          // Start the server
  HttpCode,                         // HTTP status code enum
  defineFluxionModule,              // Define an API handler
  defineFluxionMiddleware,          // Define a middleware
  defineFluxionLogger,              // Define a custom logger
  defineFluxionOptions,             // Normalize/validate options
  defineFluxionCronJob,             // Define a cronjob
  CronExpressions,                  // Common cron expression constants
  FluxionCronJobExecutionStrategy,  // Cronjob execution strategy enum

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

### Recommended: install `tsx` for TypeScript hot-reload

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
  include?: string[];              // Register files matching these. Default: ['**/*']
  apiInclude?: string[];           // API handler patterns. Default: ['**/*.ts']
  exclude?: string[];              // Exclude patterns (overrides defaults)

  // Meta API (primary process)
  metaPort?: number;               // Default: port + 1
  metaSecret?: string;             // Must be ≥20 chars, letters+digits, no whitespace

  // Worker management
  workerOptions?: {
    maxWorkerCount?: number;       // Default: 4
    restartWhen?: {
      memoryUsageGreaterThan?: number;  // MB, default: Infinity (disabled)
      healthzTimeout?: number;          // ms, default: 30000
      uptimeGreaterThan?: number;       // ms, default: Infinity (disabled)
    };
  };

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
  include: ['**/*'],             // All files registered
  apiInclude: ['**/*.ts'],       // .ts files are API handlers
  exclude: ['**/*.test.ts'],     // Exclude test files
});
```

Files like `public/index.html` become static routes at `/index.html`.
Files like `public/api/users.ts` become API routes at `/api/users.ts`.

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

### File extension is part of the route

This is intentional and matches PHP-style routing:

```
dynamic/hello.ts        → GET /hello.ts
dynamic/api/users.ts    → GET /api/users.ts
dynamic/index.html      → GET /index.html
```

### Module state is ephemeral

When a file changes, the module is reloaded. Any module-level variables (caches, counters, connections) are reset. Design handlers to be stateless.

### Worker processes

Fluxion runs in cluster mode. Each handler invocation may run in a different worker. Don't rely on shared in-memory state between requests.

### Meta API endpoints

The primary process serves meta APIs on `metaPort` (default: `port + 1`):

```
GET /_fluxion/healthz                   # Health check
GET /_fluxion/workers                   # Worker status
GET /_fluxion/routes?secret=<secret>    # Route table snapshot (requires metaSecret)
```
