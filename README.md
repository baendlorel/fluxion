# Fluxion

[![npm version](https://img.shields.io/npm/v/fluxion.svg)](https://www.npmjs.com/package/fluxion)
[![npm downloads](https://img.shields.io/npm/dm/fluxion.svg)](https://www.npmjs.com/package/fluxion)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<p align="center">
  <a href="https://baendlorel.github.io/fluxion/">
    <img src="https://raw.githubusercontent.com/baendlorel/fluxion/refs/heads/main/assets/fluxion.svg" width="240px" alt="fluxion logo" />
  </a>
</p>

Fluxion is a filesystem-routing dynamic server for Node.js.

- Use `.mjs` files directly as route handlers
- Run handlers inside worker runtime isolation
- Inject any npm module into handler `context` via `modules`
- If a handler returns a value, Fluxion auto-responds with `200 + JSON`

## Install

```bash
npm install fluxion
```

## Quick Start

### 1) Start the server

Create `server.mjs`:

```js
import { fluxion } from 'fluxion';

fluxion({
  dir: './dynamicDirectory',
  host: '127.0.0.1',
  port: 3000,
});
```

### 2) Create a route handler

Create `dynamicDirectory/hello.mjs`:

```js
export default function handler(_req, _res, context) {
  return {
    message: 'hello fluxion',
    workerId: context.worker.id,
  };
}
```

Run:

```bash
node server.mjs
```

Test:

```bash
curl http://127.0.0.1:3000/hello
```

You will get a JSON response with status `200`.

## Routing Rules

- `dynamicDirectory/index.mjs` -> `/`
- `dynamicDirectory/user.mjs` -> `/user`
- `dynamicDirectory/user/index.mjs` -> `/user`
- Non-`.mjs` files are served as static files (`GET/HEAD`)
- Directories/files starting with `_` are private and not routable

## Handler Styles

### Function export

```js
export default function handler(req, res, context) {
  return { ok: true };
}
```

### Object export (with modules)

```js
export default {
  modules: [
    {
      module: 'node:crypto',
      injectKey: 'crypto',
      factory: (cryptoModule) => cryptoModule,
    },
  ],
  handler(_req, _res, context) {
    return {
      hash: context.crypto.createHash('sha1').update('abc').digest('hex'),
    };
  },
};
```

## Automatic JSON Response

If a handler return value is not `undefined` and you do not manually call `res.end()`, Fluxion will automatically:

- set status to `200`
- set `content-type` to `application/json; charset=utf-8` (if missing)
- serialize the return value with `JSON.stringify(...)`

Recommended pattern per handler:

1. Return data directly (recommended)
2. Or fully control `res` manually (streaming, file download, etc.)

## Module Injection (Recommended)

Fluxion does not bundle database drivers. Install app dependencies yourself.

For example, to use MySQL in handlers:

```bash
npm install mysql2
```

```js
export default {
  modules: [
    {
      module: 'mysql2/promise',
      injectKey: 'mydb',
      options: {
        host: '127.0.0.1',
        user: 'root',
        password: '***',
        database: 'demo',
      },
      factory: (mysql2, options) => mysql2.createPool(options),
    },
  ],
  async handler(_req, _res, context) {
    const [rows] = await context.mydb.query('select 1 as ok');
    return rows;
  },
};
```

### `modules` fields

- `module`: module id used by dynamic `import()`
- `injectKey`: target key in `context[injectKey]`
- `options`: custom config passed into `factory`
- `factory`: `(importedModule, options, runtime) => injectedValue`

`factory` runs inside the worker and is restored from source text. Keep it self-contained (do not depend on outer closures).

Each worker keeps its own module instances. On worker shutdown, Fluxion will attempt `dispose/close/end/destroy` if present.

## Common Options

Main `fluxion({...})` options:

- `dir`: dynamic directory (handler root)
- `host`: listen host
- `port`: listen port
- `metaPort`: primary meta API port (defaults to `port + 1`)
- `maxRequestBytes`: max request body size (returns 413 when exceeded)
- `logger`: `one-line` / `json-line` / custom function

## Meta APIs

Meta APIs are served by the primary process on `metaPort`:

- `GET /_fluxion/healthz`
- `GET /_fluxion/workers` (worker status + cpu/memory stats)

## Important

Legacy handler-level `db` declarations are removed:

```js
export default {
  // db: ['main'] // no longer supported
  modules: [],
  handler() {},
};
```

Use `modules` for dependency injection.
