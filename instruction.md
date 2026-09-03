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

- **Lazy loading**: API handler modules are loaded on demand when requests arrive. No file watcher runs at runtime — zero overhead when files are stable.
- **Filesystem routing**: files under a `dir` directory become HTTP routes. The file path IS the URL path.
- **Single-process architecture**: Fluxion runs as a single process. Use pm2, docker, or kubernetes for clustering.
- **API handlers**: TypeScript/JavaScript files matching `apiInclude` patterns (default: `**/*.ts`) are loaded as handler modules.
- **Static files**: files matching `staticInclude` patterns (default: `**/*`) are served as static resources (GET/HEAD only).
- **File exclusion**: files matching `exclude` patterns are skipped.
- **No built-in metadata endpoints**: health checks and other monitoring endpoints are intentionally not provided — implement them yourself as regular API handlers.

### Package Exports

```ts
import { fluxion } from 'fluxion-ts';                    // Start the server
import { HttpCode } from 'fluxion-ts';                   // HTTP status code enum
import { defineFluxionModule } from 'fluxion-ts';        // Define an API handler
import { defineFluxionMiddleware } from 'fluxion-ts';    // Define a middleware
import { defineFluxionLogger } from 'fluxion-ts';        // Define a custom logger
import { defineFluxionOptions } from 'fluxion-ts';       // Normalize/validate options

// HTTP Exception classes
import {
  HttpException, BadRequestException, UnauthorizedException,
  ForbiddenException, NotFoundException, MethodNotAllowedException,
  NotAcceptableException, RequestTimeoutException, ConflictException,
  GoneException, PayloadTooLargeException, UnsupportedMediaTypeException,
  UnprocessableEntityException, TooManyRequestsException,
  InternalServerErrorException, NotImplementedException, BadGatewayException,
  ServiceUnavailableException, GatewayTimeoutException,
} from 'fluxion-ts';

// Type imports
import type { FluxionRequest, FluxionModuleContext, FluxionOptions } from 'fluxion-ts';
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

Relative paths are resolved relative to `moduleDir` (default: `process.cwd()`). PEM content can be passed as strings directly.

### Custom Logger

```ts
import { fluxion, defineFluxionLogger } from 'fluxion-ts';

const myLogger = defineFluxionLogger((entry) => {
  console.log(JSON.stringify(entry));
});

await fluxion({
  dir: './dynamic',
  host: 'localhost',
  port: 3000,
  logger: myLogger,
});
```

### Development: install `tsx` for TypeScript hot-reload

```bash
pnpm add -D tsx
tsx server.ts
```

---

## 3. Writing API Handlers

Every API handler **must** use `defineFluxionModule()`. Place handler files under the configured `dir`.

### Simple handler (shorthand)

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

### Short-circuiting the chain

To stop execution (e.g., auth failure), write to `rawRes` and return. The handler will NOT be called.

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

## 5. HTTP Exceptions

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

## 6. Request Object

Every handler and middleware receives a `NormalizedRequest`:

```ts
interface NormalizedRequest {
  method: string;                          // 'GET', 'POST', etc.
  ip: string;                              // Client IP (X-Forwarded-For / X-Real-IP aware)
  url: URL;                                // Parsed URL object
  query: Record<string, string | string[]>;// Query parameters
  body: Record<string, any>;              // Parsed request body
  headers: http.IncomingHttpHeaders;       // Raw headers
  cookie: Record<string, string>;          // Parsed cookies (max 100)
  meta: Record<any, any>;                 // Custom metadata (mutable, shared across middleware)
}
```

### Body parsing rules

- **GET / HEAD**: body is NOT parsed.
- **JSON** (`application/json`): objects assigned directly; primitives become `{ value }`; invalid JSON becomes `{ raw }`.
- **Form data** (`multipart/form-data`, `application/x-www-form-urlencoded`): parsed into key/value fields.
- **Text** (`text/*`): stored as `{ raw }`.
- **Binary**: read for size check; body remains `{}`.

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

## 7. Response Patterns

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

- If `rawRes.writableEnded` is true, Fluxion will NOT send another response.
- If the handler returns `undefined` and the response hasn't been ended, Fluxion sends the default JSON.
- Security headers are automatically added to all responses: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Content-Security-Policy`.

---

## 8. Options Reference

```ts
interface FluxionOptions {
  // Required
  dir: string;                    // Dynamic directory path
  host: string;                   // Bind address
  port: number;                   // HTTP port (1–65535)

  // Timeouts
  handlerTimeoutMs?: number;       // Default: 5000
  middlewareTimeoutMs?: number;    // Default: 3000
  staticResourceTimeoutMs?: number; // Default: 180000 (3 min)

  // File patterns
  apiInclude?: string[];           // API handler patterns. Default: ['**/*.ts']
  staticInclude?: string[];        // Static resource patterns. Default: ['**/*']
  exclude?: string[];              // Exclude patterns (overrides defaults)

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
}
```

---

## 9. Common Patterns & Recipes

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

### Static files alongside APIs

```ts
await fluxion({
  dir: './public',
  host: 'localhost',
  port: 3000,
  apiInclude: ['**/*.ts'],       // .ts files are API handlers
  staticInclude: ['**/*'],      // All files are static resources
  exclude: ['**/*.test.ts'],     // Exclude test files
});
```

### Lazy loading behavior

Fluxion's lazy router caches modules on first request. Subsequent requests use the cached version:

```ts
// File: dynamic/counter.ts
export default defineFluxionModule(async () => {
  return { value: Math.random() };
});
// Multiple requests to /counter.ts return the SAME value
// until the file is modified (mtime change triggers reload)
```

---

## 10. Rules & Gotchas

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
- ❌ **Don't use the `include` option** — it has been renamed to `apiInclude`/`staticInclude`. Passing `include` will throw an error.

### Module state is ephemeral

When a file changes, the module is reloaded. Any module-level variables (caches, counters, connections) are reset. Design handlers to be stateless.

### Lazy loading lifecycle

Fluxion uses a lazy loading strategy:

1. **First request**: Module is loaded from disk, parsed, and cached in memory.
2. **Subsequent requests**: Cached module is returned if `mtime` is unchanged.
3. **File modification**: Changed `mtime` triggers a reload on the next request.
4. **File deletion**: Module is disposed (calling `disposer` if set) and removed from cache. Subsequent requests return `404`.
5. **File re-creation**: After deletion, if the file is recreated, it will be re-registered on the next request.

### Security features

- **Path traversal protection**: The router validates that the resolved path stays within the configured directory.
- **Security headers**: All responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, and `Content-Security-Policy: default-src 'self'`.
- **Error message sanitization**: Internal error details are never leaked to clients. Uncaught exceptions return a generic `500 Internal Server Error` message.
- **Cookie limits**: Maximum 100 cookies per request.

### Process management

Fluxion runs as a single process. For production deployments, use process managers like pm2, docker, or kubernetes.

### Health checks / monitoring endpoints

Fluxion intentionally ships **no built-in metadata endpoints** (no `/_fluxion/*` routes). For security, nothing about the server is exposed automatically — implement health checks yourself as ordinary API handlers:

```ts
// healthz.ts — a regular handler, registered like any other route
import { defineFluxionModule } from 'fluxion-ts';

export default defineFluxionModule({
  handler: () => ({
    ok: true,
    now: Date.now(),
    uptimeSeconds: Number(process.uptime().toFixed(3)),
  }),
});
```

You control the path, the auth (e.g. a middleware that checks a token), and exactly what information is exposed.