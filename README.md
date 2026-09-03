# Fluxion

[![npm version](https://img.shields.io/npm/v/fluxion-ts.svg)](https://www.npmjs.org/package/fluxion-ts)
[![npm downloads](https://img.shields.io/npm/dm/fluxion-ts.svg)](https://www.npmjs.org/package/fluxion-ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<p align="center">
  <a href="https://baendlorel.github.io/fluxion/">
    <img src="assets/fluxion.png" width="240px" alt="fluxion logo" />
  </a>
</p>

**Fluxion** is a filesystem-routing dynamic HTTP server for Node.js — a PHP-like hot-reloadable backend.

- **Lazy loading**: API handlers are loaded on demand when requests arrive. No file scanning at startup, no watcher overhead. See the reasons here.
- **Filesystem routing**: The file path IS the URL path. Drop a `.ts` file, and it becomes an API endpoint.
- **Static file serving**: Non-API files are served as static resources with automatic content-type detection.
- **Built-in middleware system**: Sequential middleware execution with timeout support.
- **HTTP exceptions**: Rich set of typed exception classes for clean error handling.
- **No built-in metadata endpoints**: health checks and monitoring are left to you — implement them as ordinary API handlers.
- **Single-process**: Simple architecture. Use pm2, docker, or kubernetes for clustering.

## Install

```bash
pnpm add fluxion-ts
pnpm add -D tsx    # Recommended: enables TypeScript hot-reload
```

## Quick Start

Create `server.ts`:

```ts
import { fluxion } from 'fluxion-ts';

await fluxion({
  dir: './dynamic',
  host: '127.0.0.1',
  port: 3000,
});
```

Create `dynamic/hello.ts`:

```ts
import { defineFluxionModule } from 'fluxion-ts';

export default defineFluxionModule(async (req, cx) => {
  return { message: 'hello fluxion', path: req.url.pathname };
});
```

Run:

```bash
tsx server.ts
```

Request:

```bash
curl http://127.0.0.1:3000/hello.ts
```

Response:

```json
{"message":"hello fluxion","path":"/hello.ts"}
```

## Routing

Files under `dir` become routes based on glob patterns:

- Files matching `apiInclude` (default: `**/*.ts`) are API handlers.
- Files matching `staticInclude` (default: `**/*`) are static resources.
- Files matching `exclude` are skipped (default: node_modules, .git, dist, etc.).
- The file extension IS part of the route.

| File                      | Route              | Type        |
| ------------------------- | ------------------ | ----------- |
| `dynamic/hello.ts`        | `/hello.ts`        | API handler |
| `dynamic/user/profile.ts` | `/user/profile.ts` | API handler |
| `dynamic/index.html`      | `/index.html`      | Static file |
| `dynamic/assets/app.js`   | `/assets/app.js`   | Static file |

## API Handlers

Every API handler **must** use `defineFluxionModule()`.

### Simple Handler

```ts
import { defineFluxionModule } from 'fluxion-ts';

export default defineFluxionModule(async (req, cx) => {
  return { ok: true };
});
```

### Handler Arguments

```ts
handler(req, cx, rawReq, rawRes)
```

- **`req`** — Normalized request object

  ```ts
  {
    method: string;                     // HTTP method
    ip: string;                         // Client IP
    url: URL;                           // Parsed URL
    query: Record<string, string | string[]>;  // Query params
    body: Record<string, any>;           // Parsed body
    headers: IncomingHttpHeaders;
    cookie: Record<string, string>;
    meta: Record<any, any>;              // Custom metadata (shared across middleware)
  }
  ```
- **`cx`** — Module context `{ logger: FluxionLogger }`
- **`rawReq`** — Node.js `http.IncomingMessage`
- **`rawRes`** — Node.js `http.ServerResponse`

### Full Module Configuration

```ts
import { defineFluxionModule, defineFluxionMiddleware } from 'fluxion-ts';

const logMiddleware = defineFluxionMiddleware(async (req, cx) => {
  cx.logger.info('request received', { path: req.url.pathname });
});

export default defineFluxionModule({
  handler: async (req, cx) => {
    return { message: 'hello' };
  },
  middlewares: [logMiddleware],
  methods: ['GET', 'POST'],
  handlerTimeoutMs: 10000,
  disposer: async () => {
    // Cleanup when file is removed or server shuts down
  },
});
```

### Module Options

```ts
interface FluxionModule {
  handler: FluxionHandler;           // Required: main handler function
  middlewares?: FluxionMiddleware[];  // Optional: middleware array
  methods?: HTTPMethod[];            // Optional: allowed HTTP methods (default: all)
  handlerTimeoutMs?: number;         // Optional: handler timeout override
  disposer?: FluxionDisposer;         // Optional: cleanup function
}
```

## Middleware

Middleware runs sequentially **before** the handler. They can modify the request via side effects.

```ts
import { defineFluxionMiddleware, defineFluxionModule } from 'fluxion-ts';

const authMiddleware = defineFluxionMiddleware(async (req, cx, rawReq, rawRes) => {
  const token = req.headers.authorization;
  if (!token) {
    rawRes.statusCode = 401;
    rawRes.end('Unauthorized');
    return;  // Short-circuit: handler won't be called
  }
  req.meta.user = await verifyToken(token);
});

export default defineFluxionModule({
  handler: async (req) => ({ user: req.meta.user }),
  middlewares: [authMiddleware],
});
```

Middleware timeout defaults to **3000ms**. Configure via `middlewareTimeoutMs`.

## HTTP Exceptions

Throw these in handlers or middleware for clean error responses:

```ts
import { defineFluxionModule, NotFoundException, BadRequestException } from 'fluxion-ts';

export default defineFluxionModule(async (req) => {
  if (!req.query.id) {
    throw new BadRequestException('Missing id parameter');
  }

  const user = await db.findUser(req.query.id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  return { user };
});
```

| Class                           | Status |
| ------------------------------- | ------ |
| `BadRequestException`           | 400    |
| `UnauthorizedException`         | 401    |
| `ForbiddenException`            | 403    |
| `NotFoundException`             | 404    |
| `MethodNotAllowedException`     | 405    |
| `NotAcceptableException`        | 406    |
| `RequestTimeoutException`       | 408    |
| `ConflictException`             | 409    |
| `GoneException`                 | 410    |
| `PayloadTooLargeException`      | 413    |
| `UnsupportedMediaTypeException` | 415    |
| `UnprocessableEntityException`  | 422    |
| `TooManyRequestsException`      | 429    |
| `InternalServerErrorException`  | 500    |
| `NotImplementedException`       | 501    |
| `BadGatewayException`           | 502    |
| `ServiceUnavailableException`   | 503    |
| `GatewayTimeoutException`       | 504    |

## Request Body

Fluxion parses request bodies before calling handlers (except for `GET` and `HEAD`).

- **JSON** (`application/json`): objects assigned directly; primitives become `{ value }`; invalid JSON becomes `{ raw }`
- **Form data** (`multipart/form-data`, `application/x-www-form-urlencoded`): parsed into key/value fields
- **Text** (`text/*`): stored as `{ raw }`
- **Binary**: read for size check; body remains `{}`

Requests larger than `maxRequestBytes` (default: 8MB) return `413 Payload Too Large`.

## Response Behavior

Returning a value produces a `200 OK` JSON response:

```ts
export default defineFluxionModule(async () => {
  return { ok: true };
});
```

```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"ok":true}
```

Write directly to `rawRes` for custom responses:

```ts
export default defineFluxionModule(async (_req, _cx, _rawReq, res) => {
  res.statusCode = 201;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('created');
});
```

When `res.writableEnded` is true, Fluxion will not send another response.

## Static Files

Non-API files are served as static resources. Supported methods: `GET`, `HEAD`. Other methods return `405 Method Not Allowed`.

Known content types: `.html`, `.css`, `.js`, `.json`, `.png`, `.jpg`, `.jpeg`, `.svg`, `.txt`, `.webp`, `.ico`, `.map`. Unknown extensions use `application/octet-stream`.

## Lazy Loading

Fluxion uses a **lazy loading** strategy:

- Files are loaded on demand when a request arrives.
- The module is cached in memory; subsequent requests use the cached version.
- If the file's `mtime` has changed, the module is automatically reloaded.
- If the file is deleted, the module is disposed and subsequent requests return `404`.
- No file watcher runs at runtime — zero overhead when files are stable.

This means:

- **Fast startup**: No initial file scanning.
- **Automatic hot-reload**: Edit a file, and the next request picks up the change.
- **No watcher overhead**: No CPU/memory usage for file watching.

Reason:

In watch mode, frequent file modifications and creation
of temporary files by AI Agents can **block the main process**, preventing
interface files from being loaded correctly (i.e., the "watch failure"
issue).

## Health checks

Fluxion intentionally ships **no built-in metadata endpoints** (no `/_fluxion/*` routes) — for security, nothing about the server is exposed automatically. Implement health checks yourself as ordinary API handlers, controlling the path, the auth, and exactly what gets exposed:

```ts
// healthz.ts — placed in your dynamic dir, served like any other route
import { defineFluxionModule } from 'fluxion-ts';

export default defineFluxionModule({
  handler: () => ({
    ok: true,
    now: Date.now(),
    uptimeSeconds: Number(process.uptime().toFixed(3)),
  }),
});
```

## Options

```ts
interface FluxionOptions {
  dir: string;                     // Required: dynamic directory
  host: string;                    // Required: bind address
  port: number;                    // Required: HTTP port

  // Timeouts
  handlerTimeoutMs?: number;       // Default: 5000ms
  middlewareTimeoutMs?: number;    // Default: 3000ms
  staticResourceTimeoutMs?: number; // Default: 180000ms (3 min)

  // File patterns
  apiInclude?: string[];           // Default: ['**/*.ts']
  staticInclude?: string[];        // Default: ['**/*']
  exclude?: string[];              // Overrides built-in ignore list

  // Request handling
  maxRequestBytes?: number;        // Default: 8_000_000

  // Logging
  logger?: 'one-line' | 'json-line' | FluxionLoggerFn; // Default: 'one-line'

  // Module system
  moduleDir?: string;              // Default: process.cwd()

  // HTTPS
  https?: {
    key: string | Buffer;
    cert: string | Buffer;
    ca?: string | Buffer | Array<string | Buffer>;
  };
}
```

### HTTPS

```ts
fluxion({
  dir: './dynamic',
  host: '0.0.0.0',
  port: 443,
  https: {
    key: './certs/private-key.pem',
    cert: './certs/certificate.pem',
    ca: './certs/ca-bundle.crt',  // Optional
  },
});
```

Relative paths are resolved relative to `moduleDir`. PEM content can be passed directly.

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

## Security

- **Path traversal protection**: Requests are validated to ensure the resolved path stays within the configured directory.
- **Security headers**: All responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, and `Content-Security-Policy: default-src 'self'`.
- **Error message sanitization**: Internal error details are never leaked to clients.
- **Cookie limits**: Maximum 100 cookies per request.
- **Meta API authentication**: Sensitive endpoints require secret authentication.

## Process Management

Fluxion runs as a single process. For production deployments:

```bash
# pm2
pm2 start server.ts --name fluxion-app -i max

# Docker
docker build -t fluxion-app .
docker run -p 3000:3000 fluxion-app

# Kubernetes
# Use deployments and services for load balancing
```

## Build and Test

```bash
pnpm build
pnpm test
pnpm lint
```
