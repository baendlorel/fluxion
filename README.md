# Fluxion

[![npm version](https://img.shields.io/npm/v/fluxion.svg)](https://www.npmjs.com/package/fluxion)
[![npm downloads](https://img.shields.io/npm/dm/fluxion.svg)](https://www.npmjs.com/package/fluxion)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<p align="center">
  <a href="https://baendlorel.github.io/fluxion/">
    <img src="assets/fluxion.png" width="240px" alt="fluxion logo" />
  </a>
</p>

Fluxion is a filesystem-routing dynamic server for Node.js.

- Route files from a dynamic directory
- Load API handlers by extension, default: `.ts`
- Serve other files as static resources
- Run the business server in worker processes
- Expose runtime status from the primary process through meta APIs
- Automatically serialize handler return values as JSON

## Install

```bash
pnpm add fluxion
```

## Quick Start

Create `server.mjs`:

```js
import { fluxion } from 'fluxion';

fluxion({
  dir: './dynamicDirectory',
  host: '127.0.0.1',
  port: 3000,
});
```

Create `dynamicDirectory/hello.ts`:

```ts
import { defineFluxionHandler } from 'fluxion';

// defineFluxionHandler is only for better type inference and editor support.
// You can export the handler function directly without it.
export default defineFluxionHandler(async function handler(req) {
  return {
    message: 'hello fluxion',
    path: req.url.pathname,
  };
})
```

Run:

```bash
node server.mjs
```

Request:

```bash
curl http://127.0.0.1:3000/hello.ts
```

Response:

```json
{"message":"hello fluxion","path":"/hello.ts"}
```

## Development Entry

In this repository, `pnpm dev` runs `src/index.ts` directly and starts Fluxion unless `NODE_ENV=production`.

Default development options:

```ts
fluxion({
  dir: process.env.DYNAMIC_DIRECTORY ?? 'dynamicDirectory',
  host: process.env.HOST ?? 'localhost',
  port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000,
  reloadDelay: process.env.RELOAD_DELAY ? Number.parseInt(process.env.RELOAD_DELAY, 10) : undefined,
  workerOptions: {
    maxWorkerCount: 1,
  },
});
```

Example:

```bash
pnpm dev
curl http://localhost:3000/test.ts
```

## Routing

Fluxion registers every file under `dir` recursively.

With default options:

- Files ending with `.ts` are API handlers.
- Files with other extensions are static resources.
- Request paths match file paths relative to `dir`.
- File extensions are part of the route path.

Examples:

| File                               | Route              | Type        |
| ---------------------------------- | ------------------ | ----------- |
| `dynamicDirectory/test.ts`         | `/test.ts`         | API handler |
| `dynamicDirectory/user/profile.ts` | `/user/profile.ts` | API handler |
| `dynamicDirectory/index.html`      | `/index.html`      | Static file |
| `dynamicDirectory/assets/app.js`   | `/assets/app.js`   | Static file |

A request to `/hello` does not match `hello.ts`; request `/hello.ts` or change `apiExts`/routing behavior in code.

## API Handlers

An API file must export a function by one of these forms:

```ts
export default async function handler(req, rawReq, rawRes) {
  return { ok: true };
}
```

```ts
export async function handler(req, rawReq, rawRes) {
  return { ok: true };
}
```

Common local style:

```ts
import { defineFluxionHandler } from '@/index.js';

export default defineFluxionHandler(async (req) => {
  return req.url.pathname + '成功';
});
```

### Handler Arguments

```ts
handler(normalizedRequest, rawRequest, rawResponse)
```

`normalizedRequest` contains:

```ts
{
  method: string;
  ip: string;
  url: URL;
  query: Record<string, string | string[]>;
  body: Record<string, any>;
  headers: IncomingHttpHeaders;
  cookie: Record<string, string>;
}
```

`rawRequest` and `rawResponse` are Node.js HTTP objects.

## Response Behavior

If the handler returns a value, Fluxion responds with JSON:

```ts
export default async function handler() {
  return { ok: true };
}
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"ok":true}
```

You can also write to `rawResponse` manually:

```ts
export default async function handler(_req, _rawReq, res) {
  res.statusCode = 201;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('created');
}
```

When `res` has already ended, Fluxion will not send another JSON response.

## Request Body

Fluxion parses request bodies before calling the handler, except for `GET` and `HEAD`.

Supported parsing:

- JSON content types: object values are assigned directly; primitive values become `{ value }`; invalid JSON becomes `{ raw }`.
- `application/x-www-form-urlencoded`: parsed into key/value fields.
- Textual content types: stored as `{ raw }`.
- Other binary bodies are read for size checking/log preview but `body` remains `{}`.

Requests larger than `maxRequestBytes` return `413`.

## Static Files

Non-API files are served as static resources.

Supported methods:

- `GET`
- `HEAD`

Other methods return `405` with:

```http
Allow: GET, HEAD
```

Known content types include `.html`, `.css`, `.js`, `.json`, `.png`, `.jpg`, `.jpeg`, `.svg`, `.txt`, `.webp`, `.ico`, and `.map`. Unknown extensions use `application/octet-stream`.

## File Watching

Workers watch the dynamic directory recursively.

On file changes:

- existing files are re-registered;
- deleted files are removed from the router;
- updates are debounced by `reloadDelay`, default `300ms`.

## Cluster Runtime

Fluxion uses Node.js `cluster`:

- The primary process starts meta APIs and manages worker state.
- Worker processes watch the dynamic directory and serve business traffic.
- `workerOptions.maxWorkerCount` controls worker count. Default is capped by CPU count.

## Meta APIs

Meta APIs are served by the primary process on `metaPort`.

Default:

```ts
metaPort = port + 1
```

Endpoints:

```http
GET /_fluxion/healthz
GET /_fluxion/workers
```

Example:

```bash
curl http://127.0.0.1:3001/_fluxion/healthz
curl http://127.0.0.1:3001/_fluxion/workers
```

If a meta API path is requested on the business port, Fluxion returns `404` and points to the meta port.

## Options

```ts
interface FluxionOptions {
  dir: string;
  host: string;
  port: number;
  reloadDelay?: number;
  metaPort?: number;
  injections?: InjectionConfig[];
  moduleDir?: string;
  workerOptions?: Partial<WorkerOptions>;
  maxRequestBytes?: number;
  logger?: 'one-line' | 'json-line' | InjectionConfig;
  apiExts?: string[];
  routerExclude?: string[];
  https?: {
    key: string | Buffer;
    cert: string | Buffer;
    ca?: string | Buffer | Array<string | Buffer>;
  };
}
```

### `dir`

Dynamic directory root. Created automatically if missing.

### `host`

Host passed to `server.listen`.

### `port`

Business server port.

### `metaPort`

Primary meta API port. Defaults to `port + 1` and must be different from `port`.

### `reloadDelay`

Debounce delay for file re-registration. Defaults to `300` and must be at least `50`.

### `apiExts`

Extensions registered as API handlers. Defaults to:

```ts
['.ts']
```

Example:

```ts
fluxion({
  dir: './dynamicDirectory',
  host: '127.0.0.1',
  port: 3000,
  apiExts: ['.ts', '.mjs'],
});
```

### `routerExclude`

Extensions excluded from both API and static registration.

Example:

```ts
routerExclude: ['.map']
```

### `maxRequestBytes`

Maximum accepted request body size. Defaults to `8_000_000`.

### `logger`

Built-in modes:

- `one-line`
- `json-line`

A custom logger can be loaded through an injection config object whose module exports a function.

### `injections`

Worker startup injections. Each item is loaded with `require(modulePath)` and called as a factory. The resulting instances are stored on:

```ts
globalThis[Symbol.for('fluxion.injection')]
```

### `workerOptions`

Runtime tuning options:

```ts
interface WorkerOptions {
  maxWorkerCount: number;
  requestTimeoutMs: number;
  maxInflight: number;
  memorySoftLimitMb: number;
  memoryHardLimitMb: number;
  memorySampleIntervalMs: number;
  maxOldGenerationSizeMb: number;
  maxYoungGenerationSizeMb: number;
  stackSizeMb: number;
  maxResponseBytes: number;
}
```

Current implementation uses `maxWorkerCount` for process count and reports CPU/memory telemetry from workers.

### `https`

HTTPS server configuration. When provided, Fluxion creates an HTTPS server instead of HTTP.

```ts
fluxion({
  dir: './dynamicDirectory',
  host: '127.0.0.1',
  port: 9443,
  https: {
    key: './certs/private-key.pem',  // 私钥文件路径或内容
    cert: './certs/certificate.pem', // 证书文件路径或内容
    ca: './certs/ca-bundle.crt',    // 可选：CA 证书链
  },
});
```

Relative paths are resolved relative to `moduleDir`. PEM content can be passed directly as strings.

### `dir`

Dynamic directory root. Created automatically if missing.

### `host`

Host passed to `server.listen`.

### `port`

Business server port.

### `metaPort`

Primary meta API port. Defaults to `port + 1` and must be different from `port`.

### `reloadDelay`

Debounce delay for file re-registration. Defaults to `300` and must be at least `50`.

### `apiExts`

Extensions registered as API handlers. Defaults to:

```ts
['.ts']
```

Example:

```ts
fluxion({
  dir: './dynamicDirectory',
  host: '127.0.0.1',
  port: 3000,
  apiExts: ['.ts', '.mjs'],
});
```

### `routerExclude`

Extensions excluded from both API and static registration.

Example:

```ts
routerExclude: ['.map']
```

### `maxRequestBytes`

Maximum accepted request body size. Defaults to `8_000_000`.

### `logger`

Built-in modes:

- `one-line`
- `json-line`

A custom logger can be loaded through an injection config object whose module exports a function.

### `injections`

Worker startup injections. Each item is loaded with `require(modulePath)` and called as a factory. The resulting instances are stored on:

```ts
globalThis[Symbol.for('fluxion.injection')]
```

### `workerOptions`

Runtime tuning options:

```ts
interface WorkerOptions {
  maxWorkerCount: number;
  requestTimeoutMs: number;
  maxInflight: number;
  memorySoftLimitMb: number;
  memoryHardLimitMb: number;
  memorySampleIntervalMs: number;
  maxOldGenerationSizeMb: number;
  maxYoungGenerationSizeMb: number;
  stackSizeMb: number;
  maxResponseBytes: number;
}
```

Current implementation uses `maxWorkerCount` for process count and reports CPU/memory telemetry from workers.

## Build and Test

```bash
pnpm build
pnpm test
pnpm lint
```

