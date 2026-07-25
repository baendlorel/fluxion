import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FluxionRouter } from '../src/router/index.js';
import { defineFluxionOptions } from '../src/defines/options.js';
import { createLogger } from '../src/common/logger.js';
import { createWorkerServer } from '../src/cluster/server.js';
import { createPrimaryMetaApiServer } from '../src/cluster/meta-api.js';
import { FluxionModuleType } from '../src/common/consts.js';
import type { FluxionContext, FluxionRouteMeta } from '../src/types.js';
import type http from 'node:http';
import type https from 'node:https';

globalThis.$throw = (message: string): never => {
  throw new Error('[fluxion error]' + message);
};

const servers: Array<http.Server | https.Server> = [];
const tempRoots: string[] = [];
let portCursor = 19_000;

const nextPort = () => portCursor++;

const closeServer = (server: http.Server | https.Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const requestJson = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  return { status: res.status, body: await res.json() };
};

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxion-test-'));
  tempRoots.push(dir);
  return dir;
};

const writeApi = (dir: string, relativePath: string, body: string) => {
  const file = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

const makeContext = (dir: string, port = nextPort(), metaPort = nextPort(), metaSecret?: string) => {
  const options = defineFluxionOptions({
    dir,
    host: '127.0.0.1',
    port,
    metaPort,
    metaSecret,
    reloadDelay: 50,
    apiInclude: ['**/*.ts'],
    logger: () => {},
    workerOptions: { maxWorkerCount: 1 },
  });
  const cx = { options } as FluxionContext;
  cx.logger = createLogger(cx);
  cx.router = new FluxionRouter(cx);
  return cx;
};

const startWorkerServer = async (cx: FluxionContext) => {
  const server = await createWorkerServer(cx);
  servers.push(server);
  return server;
};

const register = (cx: FluxionContext, relativePath: string) =>
  cx.router.register(path.join(cx.options.dir, relativePath), relativePath);

beforeEach(() => {
  delete process.env.WORKER_ID;
});

afterAll(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('flexible router registration', () => {
  test('throws error when deprecated include option is used', async () => {
    const dir = makeTempDir();
    expect(() => {
      defineFluxionOptions({
        dir,
        host: '127.0.0.1',
        port: nextPort(),
        metaPort: nextPort(),
        include: ['**/*.ts'], // This should throw an error
        apiInclude: ['**/*.ts'],
        logger: () => {},
      });
    }).toThrow(
      /The "include" option has been removed.*apiInclude.*staticInclude/s
    );
  });

  test('registers api and static files, updates api handlers, and removes deleted files with sync fs operations', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);

    writeApi(dir, 'hello.ts', "exports.default = { type: 0, handler: () => ({ message: 'hello-v1' }) };\n");
    fs.writeFileSync(path.join(dir, 'asset.txt'), 'asset-v1');

    await register(cx, 'hello.ts');
    await register(cx, 'asset.txt');

    expect(cx.router.getModule(new URL('http://local/hello.ts'))?.type).toBe(FluxionModuleType.Api);
    expect(cx.router.getModule(new URL('http://local/asset.txt'))?.type).toBe(FluxionModuleType.StaticResource);
    expect(cx.router.getRoutes()).toEqual([
      { path: '/asset.txt', type: 'static', methods: null },
      { path: '/hello.ts', type: 'api', methods: null },
    ]);

    let server = await startWorkerServer(cx);
    expect(await requestJson(`http://127.0.0.1:${cx.options.port}/hello.ts`)).toEqual({
      status: 200,
      body: { message: 'hello-v1' },
    });

    await closeServer(server);
    servers.splice(servers.indexOf(server), 1);

    writeApi(dir, 'hello.ts', "exports.default = { type: 0, handler: () => ({ message: 'hello-v2' }) };\n");
    await register(cx, 'hello.ts');
    server = await startWorkerServer(cx);

    expect(await requestJson(`http://127.0.0.1:${cx.options.port}/hello.ts`)).toEqual({
      status: 200,
      body: { message: 'hello-v2' },
    });

    fs.rmSync(path.join(dir, 'hello.ts'));
    await register(cx, 'hello.ts');
    expect(cx.router.getModule(new URL('http://local/hello.ts'))).toBeUndefined();
    expect((await requestJson(`http://127.0.0.1:${cx.options.port}/hello.ts`)).status).toBe(404);
  });

  test('honors staticInclude, exclude, apiInclude, and method declarations', async () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, 'private'));
    fs.writeFileSync(path.join(dir, 'page.html'), '<h1>ok</h1>');
    fs.writeFileSync(path.join(dir, 'ignore.txt'), 'ignore');
    fs.writeFileSync(path.join(dir, 'private', 'hidden.ts'), 'hidden');
    writeApi(
      dir,
      'post.api.ts',
      "exports.default = { type: 0, methods: ['POST'], handler: (req) => ({ method: req.method }) };\n",
    );

    const options = defineFluxionOptions({
      dir,
      host: '127.0.0.1',
      port: nextPort(),
      metaPort: nextPort(),
      staticInclude: ['**/*.api.ts', '**/*.html'],
      exclude: ['private/**'],
      apiInclude: ['**/*.api.ts'],
      logger: () => {},
    });
    const cx = { options } as FluxionContext;
    cx.logger = createLogger(cx);
    cx.router = new FluxionRouter(cx);

    await register(cx, 'post.api.ts');
    await register(cx, 'page.html');
    await register(cx, 'ignore.txt');
    await register(cx, path.join('private', 'hidden.ts'));

    expect(cx.router.getRoutes()).toEqual([
      { path: '/page.html', type: 'static', methods: null },
      { path: '/post.api.ts', type: 'api', methods: ['POST'] },
    ]);

    await startWorkerServer(cx);
    expect((await requestJson(`http://127.0.0.1:${cx.options.port}/post.api.ts`)).status).toBe(405);
    expect(
      await requestJson(`http://127.0.0.1:${cx.options.port}/post.api.ts`, {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
    ).toEqual({ status: 200, body: { method: 'POST' } });
  });
});

describe('middleware', () => {
  test('runs middleware in order and exposes middleware-mutated request state to handler', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);
    writeApi(
      dir,
      'middleware.ts',
      `exports.default = { type: 0,
        middlewares: [
          (req) => { req.meta.steps = ['first']; req.query.fromMiddleware = 'yes'; },
          (req) => { req.meta.steps.push('second'); },
        ],
        handler: (req) => ({ steps: req.meta.steps, fromMiddleware: req.query.fromMiddleware, body: req.body })
      };\n`,
    );
    await register(cx, 'middleware.ts');
    await startWorkerServer(cx);

    expect(
      await requestJson(`http://127.0.0.1:${cx.options.port}/middleware.ts`, {
        method: 'POST',
        body: JSON.stringify({ input: 1 }),
        headers: { 'content-type': 'application/json' },
      }),
    ).toEqual({
      status: 200,
      body: { steps: ['first', 'second'], fromMiddleware: 'yes', body: { input: 1 } },
    });
  });

  test('stops before handler when middleware writes the response', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);
    writeApi(
      dir,
      'guard.ts',
      `exports.default = { type: 0,
        middlewares: [(_req, _cx, _rawReq, res) => { res.statusCode = 401; res.end(JSON.stringify({ blocked: true })); }],
        handler: () => ({ reached: true })
      };\n`,
    );
    await register(cx, 'guard.ts');
    await startWorkerServer(cx);

    expect(await requestJson(`http://127.0.0.1:${cx.options.port}/guard.ts`)).toEqual({
      status: 401,
      body: { blocked: true },
    });
  });
});

describe('meta api', () => {
  test('serves healthz and workers endpoints through node fetch', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);
    const server = createPrimaryMetaApiServer(
      cx,
      () => ({ workers: [{ slot: 1, state: 'ready' }] }),
      async () => [],
    );
    servers.push(server);

    const healthz = await requestJson(`http://127.0.0.1:${cx.options.metaPort}/_fluxion/healthz`);
    expect(healthz.status).toBe(200);
    expect(healthz.body.ok).toBe(true);
    expect(healthz.body.role).toBe('primary');

    expect(await requestJson(`http://127.0.0.1:${cx.options.metaPort}/_fluxion/workers`)).toEqual({
      status: 200,
      body: { ok: true, now: expect.any(Number), workers: { workers: [{ slot: 1, state: 'ready' }] } },
    });
  });

  test('keeps routes endpoint disabled without a valid metaSecret', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir, nextPort(), nextPort(), undefined);
    const server = createPrimaryMetaApiServer(
      cx,
      () => ({}),
      async () => [{ path: '/hidden.ts', type: 'api', methods: null }],
    );
    servers.push(server);

    expect((await requestJson(`http://127.0.0.1:${cx.options.metaPort}/_fluxion/routes?secret=anything`)).status).toBe(
      404,
    );
  });

  test('protects and returns router snapshot when metaSecret is valid', async () => {
    const dir = makeTempDir();
    const secret = 'abc12345678901234567';
    const routes: FluxionRouteMeta[] = [
      { path: '/api.ts', type: 'api', methods: ['GET'] },
      { path: '/index.html', type: 'static', methods: null },
    ];
    const cx = makeContext(dir, nextPort(), nextPort(), secret);
    const server = createPrimaryMetaApiServer(
      cx,
      () => ({}),
      async () => routes,
    );
    servers.push(server);

    expect((await requestJson(`http://127.0.0.1:${cx.options.metaPort}/_fluxion/routes?secret=wrong`)).status).toBe(
      403,
    );
    expect(await requestJson(`http://127.0.0.1:${cx.options.metaPort}/_fluxion/routes?secret=${secret}`)).toEqual({
      status: 200,
      body: { ok: true, now: expect.any(Number), routes },
    });
  });

  test('validates metaSecret requirements', () => {
    const dir = makeTempDir();
    const base = { dir, host: '127.0.0.1', port: nextPort(), metaPort: nextPort(), logger: () => {} };
    const message =
      'FluxionOptions.metaSecret must be a string with at least 20 characters, include both letters and digits, and contain no whitespace';

    expect(defineFluxionOptions({ ...base, metaSecret: undefined }).metaSecret).toBeUndefined();
    expect(() => defineFluxionOptions({ ...base, port: nextPort(), metaPort: nextPort(), metaSecret: '' })).toThrow(
      message,
    );
    expect(() =>
      defineFluxionOptions({ ...base, port: nextPort(), metaPort: nextPort(), metaSecret: 'abcdefghijklmnopqrst' }),
    ).toThrow(message);
    expect(() =>
      defineFluxionOptions({ ...base, port: nextPort(), metaPort: nextPort(), metaSecret: '12345678901234567890' }),
    ).toThrow(message);
    expect(() =>
      defineFluxionOptions({ ...base, port: nextPort(), metaPort: nextPort(), metaSecret: 'abc123 4567890123456' }),
    ).toThrow(message);
    expect(
      defineFluxionOptions({ ...base, port: nextPort(), metaPort: nextPort(), metaSecret: 'abc12345678901234567' })
        .metaSecret,
    ).toBe('abc12345678901234567');
  });
});
