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
- Simple single-process architecture (use pm2/docker/k8s for clustering)
- Meta APIs integrated into main server at `/_fluxion/*` endpoints
- Automatically serialize handler return values as JSON
- Built-in middleware system and HTTP exception handling
- Hot-reloadable cronjobs for scheduled tasks
- Flexible API path mapping with custom transformers

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
  metaApis: ['healthz', 'version', 'routes'],
  metaSecret: process.env.META_SECRET, // Optional, for routes endpoint
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
import { defineFluxionModule } from 'fluxion-ts';

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

Note: Import types from the package when needed:
```ts
import type { FluxionRequest, FluxionModuleContext } from 'fluxion-ts';
import type http from 'node:http';
```

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

The server watches the dynamic directory recursively.

On file changes:

- Existing files are re-registered
- Deleted files are removed from the router
- Updates are debounced by `reloadDelay` (default: `500ms`)

## Process Management

Fluxion runs as a single process for simplicity. For production deployments:

- **pm2**: `pm2 start server.ts --name fluxion-app -i max`
- **docker**: Use your orchestration platform for scaling
- **kubernetes**: Use deployments and services for load balancing

This simplifies the framework while giving you flexibility in process management.

## Meta APIs

Meta APIs are integrated into the main server at `/_fluxion/*` endpoints.

Available endpoints (configurable via `metaApis` option):

```http
GET /_fluxion/healthz                 # Health check (default: enabled)
GET /_fluxion/version                 # Version info (default: enabled)
GET /_fluxion/routes?secret=<secret>  # Router snapshot (default: enabled, requires metaSecret)
```

Example:

```bash
curl http://127.0.0.1:3000/_fluxion/healthz
curl http://127.0.0.1:3000/_fluxion/version
curl 'http://127.0.0.1:3000/_fluxion/routes?secret=your-20-char-secret1'
```

### Meta API Configuration

```ts
await fluxion({
  // ... other options
  metaApis: ['healthz', 'version'],  // Only enable healthz and version
  metaSecret: 'your-20-char-secret1', // Required for routes endpoint
});
```

## Options

```ts
interface FluxionOptions {
  dir: string;                    // Required: dynamic directory
  host: string;                   // Required: server host
  port: number;                   // Required: server port

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
  metaApis?: ('healthz' | 'version' | 'routes')[];  // Default: ['healthz', 'version', 'routes']
  metaSecret?: string;             // Required for routes endpoint: >= 20 chars, letters+digits, no whitespace

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

  // Cronjobs
  cronjobDir?: string;             // Cronjob directory (undefined = disabled)
  cronjobInclude?: string[];       // Default: ['**/*.ts']
  cronjobExclude?: string[];       // Default: []
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

### Process Management with pm2

```bash
# Install pm2
npm install -g pm2

# Start with clustering
pm2 start server.ts --name fluxion-app -i max

# View status
pm2 status

# View logs
pm2 logs fluxion-app

# Restart
pm2 restart fluxion-app
```

### Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
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

## Cronjobs

Fluxion supports hot-reloadable scheduled tasks. Enable by setting `cronjobDir` in server options.

### Defining a Cronjob

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

### Cron Expression Shortcuts

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

### Execution Strategies

| Strategy | Behavior |
|----------|----------|
| `FluxionCronJobExecutionStrategy.WaitForCompletion` | Skip this tick if the previous run is still running (default) |
| `FluxionCronJobExecutionStrategy.Immediate` | Fire immediately, even if previous run hasn't finished |

### Configuration

```ts
await fluxion({
  dir: './dynamic',
  host: 'localhost',
  port: 3000,
  cronjobDir: './cronjobs',          // Enable cronjobs
  cronjobInclude: ['**/*.ts'],        // Default: ['**/*.ts']
  cronjobExclude: ['*.test.ts'],     // Exclude test files
});
```

## Recent Updates

### v1.0.0 (Current Major Release)

**Architecture Simplification**

- 🔄 **Removed cluster mode** - Fluxion now runs as a single process for simplicity
- ✨ **Meta APIs integrated** - All meta endpoints now served from main server at `/_fluxion/*`
- ✨ **Configurable endpoints** - Use `metaApis` option to control which endpoints are enabled
- ✨ **Standard deployment** - Use pm2, docker, or kubernetes for clustering and scaling
- 🔄 **Removed options** - `workerOptions`, `metaPort` no longer needed

**Benefits**

- Simpler architecture and easier maintenance
- Better integration with modern deployment tools
- Flexible process management
- Reduced framework complexity

**Migration Guide**

```ts
// OLD (v0.16.x)
await fluxion({
  dir: './dynamic',
  host: 'localhost',
  port: 3000,
  metaPort: 3001,              // ❌ Removed
  workerOptions: {             // ❌ Removed
    maxWorkerCount: 4,
  },
});

// NEW (v1.0.0)
await fluxion({
  dir: './dynamic',
  host: 'localhost',
  port: 3000,
  metaApis: ['healthz', 'version', 'routes'],  // ✅ Added
  metaSecret: 'your-secret-12345',             // ✅ Required for routes endpoint
});

// For clustering, use pm2:
// pm2 start server.ts --name fluxion-app -i max
```

**Meta API Changes**

```bash
# OLD: Separate meta server
curl http://localhost:3001/_fluxion/healthz
curl http://localhost:3001/_fluxion/workers

# NEW: Integrated into main server
curl http://localhost:3000/_fluxion/healthz
curl http://localhost:3000/_fluxion/version
curl 'http://localhost:3000/_fluxion/routes?secret=your-secret-12345'
```

### v0.16.5

**API Path Mapping**

- ✨ Added `apiMapper` option to control how API file paths are transformed into URL routes
- ✨ Support for custom mapping functions
- ✨ Preset options: `'remove-ext'` (default) and `'identical'`
- 🔄 Changed default behavior to remove file extensions from API routes

**Logging Enhancements**

- ✨ Core-level logging for framework internals
- ✨ Timestamp format changed to ISO 8601 standard
- ✨ Version information now displayed on startup

**Type Safety**

- ✨ Enhanced type definitions for better IDE support
- ✨ Improved module validation with clearer error messages

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
