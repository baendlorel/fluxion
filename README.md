# Fluxion

[![npm version](https://img.shields.io/npm/v/fluxion-ts.svg)](https://www.npmjs.org/package/fluxion-ts)
[![npm downloads](https://img.shields.io/npm/dm/fluxion-ts.svg)](https://www.npmjs.org/package/fluxion-ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<p align="center">
  <a href="https://baendlorel.github.io/fluxion/">
    <img src="assets/fluxion.png" width="240px" alt="fluxion logo" />
  </a>
</p>

Fluxion is a filesystem-routing dynamic server for Node.js.

- Route files from a dynamic directory by chokidar or native `fs.watch`
- Load API handlers by extension patterns (default: `*.ts`)
- Serve other files as static resources
- Run the business server in worker processes
- Expose runtime status from the primary process through meta APIs
- Automatically serialize handler return values as JSON
- Built-in middleware system and HTTP exception handling

## Install

```bash
pnpm add fluxion-ts 
pnom add -D tsx # Recommanded, this enables fluxion to hot reload ts files
```

Fluxion is started programmatically from your own Node.js entry file. There is no built-in CLI entry anymore.

## Quick Start

Create `server.ts`:

```ts
import { fluxion } from 'fluxion-ts';

await fluxion({
  dir: './dynamicDirectory',
  host: '127.0.0.1',
  port: 3000,
});
```

Create `dynamicDirectory/hello.ts`:

```ts
import { defineFluxionModule } from 'fluxion-ts';

export default defineFluxionModule(async (req, cx) => {
  return {
    message: 'hello fluxion',
    path: req.url.pathname,
  };
});
```

Run:

```bash
tsx  server.ts
```

Request:

```bash
curl http://127.0.0.1:3000/hello.ts
```

Response:

```json
{"message":"hello fluxion","path":"/hello.ts"}
```

## Bootstrap Entry

Your application is responsible for creating the bootstrap file and passing options to `fluxion()`.

Example:

```ts
await fluxion({
  dir: process.env.DYNAMIC_DIRECTORY ?? './dynamicDirectory',
  host: process.env.HOST ?? '127.0.0.1',
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  metaPort: Number.parseInt(process.env.META_PORT ?? '3001', 10),
  workerOptions: {
    maxWorkerCount: 4,
  },
});
```

## Routing

Fluxion registers files under `dir` based on glob patterns:

- Files matching `apiInclude` (default: `**/*.ts`) are API handlers.
- Files matching `staticInclude` (default: `**/*`) are static resources.
- Files matching `exclude` are skipped (default: node_modules, .git, dist, etc.).
- Request paths match file paths relative to `dir`.
- File extensions are part of the route path.

Examples:

| File                               | Route            | Type        |
| ---------------------------------- | ---------------- | ----------- |
| `dynamicDirectory/test.ts`         | `/test`          | API handler |
| `dynamicDirectory/user/profile.ts` | `/user/profile`  | API handler |
| `dynamicDirectory/index.html`      | `/index.html`    | Static file |
| `dynamicDirectory/assets/app.js`   | `/assets/app.js` | Static file |

**Note:** API routes have file extensions removed by default (controlled by `removeApiFileExt` option).

## API Handlers

An API handler **MUST** use `defineFluxionModule()` to define the module. This provides type safety and ensures proper module structure.

### Basic Handler

```ts
import { defineFluxionModule } from 'fluxion';

export default defineFluxionModule(async (req, cx) => {
  return { ok: true };
});
```

### Handler Arguments

Handlers receive 4 parameters:

```ts
handler(req, cx, rawReq, rawRes)
```

- **`req`**: Normalized request object
  ```ts
  {
    method: string;           // HTTP method
    ip: string;               // Client IP
    url: URL;                 // Parsed URL
    query: Record<string, string | string[]>;  // Query params
    body: Record<string, any>; // Parsed body
    headers: IncomingHttpHeaders;
    cookie: Record<string, string>;
    meta: Record<any, any>;   // Custom metadata
  }
  ```

- **`cx`**: Module context
  ```ts
  {
    logger: FluxionLogger;    // Logger instance
  }
  ```

- **`rawReq`**: Node.js `http.IncomingMessage`

- **`rawRes`**: Node.js `http.ServerResponse`

### Advanced Module Configuration

```ts
import { defineFluxionModule, defineFluxionMiddleware } from 'fluxion-ts';

const logMiddleware = defineFluxionMiddleware(async (req, cx) => {
  cx.logger.info('Request received', { path: req.url.pathname });
});

export default defineFluxionModule({
  handler: async (req, cx) => {
    return { message: 'hello' };
  },
  middlewares: [logMiddleware],
  methods: ['GET', 'POST'],
  handlerTimeoutMs: 10000,
});
```

### Module Options

```ts
interface FluxionModule {
  handler: FluxionHandler;          // Required: main handler function
  middlewares?: FluxionMiddleware[];  // Optional: middleware array
  methods?: HTTPMethod[];           // Optional: allowed HTTP methods
  handlerTimeoutMs?: number;         // Optional: handler timeout (ms)
  disposer?: FluxionDispose;        // Optional: cleanup function
}
```

## Middleware

Middleware functions execute sequentially before the handler. They can modify request parameters through side effects.

```ts
import { defineFluxionMiddleware, defineFluxionModule } from 'fluxion-ts';

const authMiddleware = defineFluxionMiddleware(async (req, cx, rawReq, rawRes) => {
  const token = req.headers.authorization;
  if (!token) {
    rawRes.statusCode = 401;
    rawRes.end('Unauthorized');
    return;
  }
  // Modify request for next middleware/handler
  req.meta.user = await verifyToken(token);
});

export default defineFluxionModule({
  handler: async (req) => {
    return { user: req.meta.user };
  },
  middlewares: [authMiddleware],
});
```

**Important**: Middleware timeout defaults to 3000ms. Configure via `middlewareTimeoutMs` option.

## HTTP Exceptions

Fluxion provides built-in HTTP exception classes for better error handling:

```ts
import {
  defineFluxionModule,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from 'fluxion-ts';

export default defineFluxionModule(async (req) => {
  if (!req.query.id) {
    throw new BadRequestException('Missing required parameter: id');
  }

  const user = await getUser(req.query.id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  return { user };
});
```

Available exception classes:

- `BadRequestException` (400)
- `UnauthorizedException` (401)
- `ForbiddenException` (403)
- `NotFoundException` (404)
- `MethodNotAllowedException` (405)
- `RequestTimeoutException` (408)
- `ConflictException` (409)
- `UnsupportedMediaTypeException` (415)
- `UnprocessableEntityException` (422)
- `TooManyRequestsException` (429)
- `InternalServerErrorException` (500)
- `NotImplementedException` (501)
- `BadGatewayException` (502)
- `ServiceUnavailableException` (503)
- `GatewayTimeoutException` (504)

## Request Body

Fluxion parses request bodies before calling handlers (except for `GET` and `HEAD`).

Supported parsing:

- **JSON**: Objects assigned directly; primitives become `{ value }`; invalid JSON becomes `{ raw }`
- **Form data**: Parsed into key/value fields
- **Text**: Stored as `{ raw }`
- **Binary**: Read for size checking; body remains `{}`

Requests larger than `maxRequestBytes` return `413 Payload Too Large`.

## Response Behavior

If the handler returns a value, Fluxion responds with JSON:

```ts
export default defineFluxionModule(async () => {
  return { ok: true };
});
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"ok":true}
```

You can also write to `rawRes` manually:

```ts
export default defineFluxionModule(async (_req, _cx, _rawReq, res) => {
  res.statusCode = 201;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('created');
});
```

When `res` has already ended, Fluxion will not send another JSON response.

## Static Files

Non-API files are served as static resources.

Supported methods:

- `GET`
- `HEAD`

Other methods return `405 Method Not Allowed`.

Known content types: `.html`, `.css`, `.js`, `.json`, `.png`, `.jpg`, `.jpeg`, `.svg`, `.txt`, `.webp`, `.ico`, `.map`. Unknown extensions use `application/octet-stream`.

## File Watching

Workers watch the dynamic directory recursively.

On file changes:

- Existing files are re-registered
- Deleted files are removed from the router
- Updates are debounced by `reloadDelay` (default: `500ms`)

## Cluster Runtime

Fluxion uses Node.js `cluster`:

- **Primary process**: Starts meta APIs and manages worker state
- **Worker processes**: Watch the dynamic directory and serve business traffic
- **Worker count**: Controlled by `workerOptions.maxWorkerCount` (default: `4`, capped by CPU count)

## Meta APIs

Meta APIs are served by the primary process on `metaPort` (default: `port + 1`).

Available endpoints:

```http
GET /_fluxion/healthz                 # Health check
GET /_fluxion/workers                 # Worker status
GET /_fluxion/routes?secret=<secret>  # Router snapshot, enabled when metaSecret is >= 20 chars with letters and digits, no whitespace
```

Example:

```bash
curl http://127.0.0.1:3001/_fluxion/healthz
curl http://127.0.0.1:3001/_fluxion/workers
curl 'http://127.0.0.1:3001/_fluxion/routes?secret=your-20-char-secret1'
```

## Options

```ts
interface FluxionOptions {
  dir: string;                    // Required: dynamic directory
  host: string;                   // Required: server host
  port: number;                   // Required: business server port

  // Optional timeout configurations
  handlerTimeoutMs?: number;       // Default: 5000ms
  middlewareTimeoutMs?: number;   // Default: 3000ms
  staticResourceTimeoutMs?: number; // Default: 6000000ms (100min)

  // File watching
  reloadDelay?: number;            // Default: 500ms
  nativeWatcher?: boolean;        // Use fs.watch instead of chokidar

  // File registration patterns
  apiInclude?: string[];          // Default: ['**/*.ts']
  staticInclude?: string[];       // Default: ['**/*']
  exclude?: string[];             // Overrides the built-in ignore list
  apiMapper?: string | function;  // Transform API file paths to routes (default: 'remove-ext')

  // Meta API
  metaPort?: number;               // Default: port + 1
  metaSecret?: string;             // Enables routes meta API when >= 20 chars, letters+digits, no whitespace

  // Worker management
  workerOptions?: {
    maxWorkerCount?: number;      // Default: 4
    restartWhen?: {
      memoryUsageGreaterThan?: number;  // MB
      healthzTimeout?: number;         // Default: 30000ms
      uptimeGreaterThan?: number;      // ms
    };
  };

  // Request handling
  maxRequestBytes?: number;        // Default: 8_000_000

  // Logging
  logger?: 'one-line' | 'json-line' | FluxionLoggerFn; // Default: 'one-line'

  // Module system
  moduleDir?: string;              // Default: process.cwd()

  // HTTPS
  https?: {
    key: string;
    cert: string;
    ca?: string | Array<string | Buffer> | Buffer;
  };
}
```

### Timeout Configurations

```ts
fluxion({
  // ...other options
  handlerTimeoutMs: 10000,         // Handler execution timeout
  middlewareTimeoutMs: 5000,       // Middleware execution timeout
  staticResourceTimeoutMs: 600000, // Static file serving timeout
});
```

### File Registration Patterns

```ts
fluxion({
  apiInclude: ['*.ts', '*.api.js'],     // Register as API handlers
  staticInclude: ['*.html', '*.css'],   // Register as static resources
  exclude: ['*.test.ts', '*.spec.ts'],  // Exclude from registration
  apiMapper: 'remove-ext',              // Remove .ts/.js extensions from API routes (default)
});
```

### API Path Mapping

Control how API file paths are transformed into URL routes using the `apiMapper` option:

```ts
// Preset: Remove file extensions (default)
fluxion({ apiMapper: 'remove-ext' });
// user/profile.ts → /user/profile

// Preset: Keep paths unchanged
fluxion({ apiMapper: 'identical' });
// user/profile.ts → /user/profile.ts

// Custom mapper function
fluxion({
  apiMapper: (path) => path
    .replace(/\.ts$/, '')
    .replace(/^api\//, '/api/v1/')
});
// api/users.ts → /api/v1/users
```

### Worker Restart Conditions

```ts
fluxion({
  workerOptions: {
    maxWorkerCount: 4,
    restartWhen: {
      memoryUsageGreaterThan: 256,  // MB - recycle at 256MB RSS
      healthzTimeout: 30000,        // ms - recycle after 30s no response
      uptimeGreaterThan: 6 * 3600_000, // ms - rotate every 6 hours
    },
  },
});
```

### HTTPS Configuration

```ts
fluxion({
  dir: './dynamicDirectory',
  host: '127.0.0.1',
  port: 9443,
  https: {
    key: './certs/private-key.pem',
    cert: './certs/certificate.pem',
    ca: './certs/ca-bundle.crt',  // Optional
  },
});
```

Relative paths are resolved relative to `moduleDir`. PEM content can be passed directly as strings.

Default exclusions in the current implementation include `node_modules`, `.git`, `dist`, `build`, `.vscode`, `.idea`, `coverage`, `.nyc_output`, `*.log`, `*.tmp`, and `*.temp`.

## Recent Updates

### v0.11.x

**Middleware & Module System**

- ✨ Added `defineFluxionModule()` and `defineFluxionMiddleware()` for type safety
- ✨ Middleware execution with timeout support via `middlewareTimeoutMs`
- ✨ Module context includes logger support
- ✨ Enhanced module type validation
- ✨ Added `meta` field for custom metadata

**Logging**

- 🔄 Unified logging interface: merged `event` and `message` into single `message` field
- ✨ Simplified logger API across all methods

**Handler Parameters**

- 🔄 Handler signature: `(req, cx, rawReq, rawRes)` - 4 parameters for better ergonomics
- ✨ Module context (`cx`) provides logger access

### v0.10.x

**HTTP Exception Handling**

- 🔄 Refactored HTTP exception classes with proper error codes
- ✨ Expanded `HttpCode` enum with additional status codes
- ✨ Added comprehensive HTTP exception classes
- 📦 Exported exception classes for user applications

**Worker Management**

- ✨ Proactive worker recycling (memory, health, uptime)
- ✨ Enhanced worker pool tuning with `restartWhen` options

### v0.9.x

- ✨ Initial middleware support
- ✨ Worker restart conditions for memory management
- ✨ Restructured build and publish flow

## Build and Test

```bash
pnpm build
pnpm test
pnpm lint
```
