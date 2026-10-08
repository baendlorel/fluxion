import { afterAll, describe, expect, test } from 'vitest';
import fs, { Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FluxionRouter } from '../src/router/lazy.js';
import { defineFluxionOptions } from '../src/defines/options.js';
import { createLogger } from '../src/common/logger.js';
import { createServer } from '../src/http/server.js';
import { FluxionModuleType } from '../src/common/consts.js';
import type { FluxionContext } from '../src/types.js';
import type http from 'node:http';
import type https from 'node:https';

globalThis._throw = (message: string): never => {
  throw new Error('[fluxion error]' + message);
};

const servers: Array<http.Server | https.Server> = [];
const tempRoots: string[] = [];
let portCursor = 30_000;

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxion-lazy-test-'));
  tempRoots.push(dir);
  return dir;
};

const writeApi = (dir: string, relativePath: string, body: string) => {
  const file = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

const makeContext = (dir: string, port = nextPort()) => {
  const options = defineFluxionOptions({
    dir,
    host: '127.0.0.1',
    port,
    apiInclude: ['**/*.ts'],
    logger: () => {},
  });
  const cx = { options } as FluxionContext;
  cx.logger = createLogger(cx);
  cx.router = new FluxionRouter(cx);
  return cx;
};

const startWorkerServer = async (cx: FluxionContext) => {
  const server = await createServer(cx);
  servers.push(server);
  return server;
};

const register = (cx: FluxionContext, relativePath: string, stat: Stats) =>
  cx.router.register(path.join(cx.options.dir, relativePath), relativePath, stat);

afterAll(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('lazy route — empty start', () => {
  test('returns no routes before any registration', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);

    // No files registered yet — routes should be empty
    expect(cx.router.getRoutes()).toEqual([]);

    // GET on any path should return undefined
    expect(await cx.router.get(new URL('http://local/anything.ts'))).toBeUndefined();
    expect(await cx.router.get(new URL('http://local/'))).toBeUndefined();
  });

  test('returns 404 on HTTP request before any file is registered', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);
    await startWorkerServer(cx);

    const res = await requestJson(`http://127.0.0.1:${cx.options.port}/hello.ts`);
    expect(res.status).toBe(404);
  });
});

describe('lazy route — cache behavior', () => {
  test('returns cached module when mtimeMs is unchanged', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);

    // Register an API
    writeApi(dir, 'greeting.ts', "exports.default = { type: 0, handler: () => ({ msg: 'hello' }) };\n");
    const stat1 = fs.statSync(path.join(dir, 'greeting.ts'));

    // First registration loads the module
    const module1 = await register(cx, 'greeting.ts', stat1);
    expect(module1).toBeDefined();
    expect(module1!.handler).toBeTypeOf('function');

    // GET via lazy router — returns the same module (cached, mtime matches)
    const get1 = await cx.router.get(new URL('http://local/greeting.ts'));
    expect(get1).toBe(module1); // same reference = cached

    // GET again — still cached because mtimeMs matches
    const get2 = await cx.router.get(new URL('http://local/greeting.ts'));
    expect(get2).toBe(module1);
  });

  test('reloads module when mtimeMs changes', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);

    // Write initial version
    writeApi(dir, 'counter.ts', "exports.default = { type: 0, handler: () => ({ value: 1 }) };\n");
    await register(cx, 'counter.ts', fs.statSync(path.join(dir, 'counter.ts')));

    // Verify initial response
    await startWorkerServer(cx);
    expect(await requestJson(`http://127.0.0.1:${cx.options.port}/counter.ts`)).toEqual({
      status: 200,
      body: { value: 1 },
    });

    // Update file content (changes mtime)
    await new Promise((r) => setTimeout(r, 100)); // ensure distinct mtime
    writeApi(dir, 'counter.ts', "exports.default = { type: 0, handler: () => ({ value: 2 }) };\n");
    const stat2 = fs.statSync(path.join(dir, 'counter.ts'));

    // GET triggers lazy reload because mtime differs
    const module2 = await cx.router.get(new URL('http://local/counter.ts'));
    expect(module2).toBeDefined();
    expect(module2!.mtimeMs).toBe(stat2.mtimeMs);

    // Response should now reflect the new version
    expect(await requestJson(`http://127.0.0.1:${cx.options.port}/counter.ts`)).toEqual({
      status: 200,
      body: { value: 2 },
    });
  });

  test('multiple GET calls with same mtime return the same cached module instance', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);

    writeApi(dir, 'cachecheck.ts', "exports.default = { type: 0, handler: () => ({ n: Math.random() }) };\n");
    await register(cx, 'cachecheck.ts', fs.statSync(path.join(dir, 'cachecheck.ts')));

    // get() should return the same module reference (not re-loaded)
    const m1 = await cx.router.get(new URL('http://local/cachecheck.ts'));
    const m2 = await cx.router.get(new URL('http://local/cachecheck.ts'));
    const m3 = await cx.router.get(new URL('http://local/cachecheck.ts'));

    expect(m1).toBe(m2);
    expect(m2).toBe(m3);
  });
});

describe('lazy route — disposal on deletion', () => {
  test('disposes handler when file is deleted and triggers get()', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);

    (globalThis as any).__lazy_disposed = false;
    writeApi(
      dir,
      'disposable.ts',
      `exports.default = { type: 0,
        handler: () => ({ status: 'alive' }),
        disposer: () => { (globalThis as any).__lazy_disposed = true; },
      };\n`,
    );
    await register(cx, 'disposable.ts', fs.statSync(path.join(dir, 'disposable.ts')));

    await startWorkerServer(cx);

    // Confirm it works
    expect(await requestJson(`http://127.0.0.1:${cx.options.port}/disposable.ts`)).toEqual({
      status: 200,
      body: { status: 'alive' },
    });

    // Delete the file
    fs.rmSync(path.join(dir, 'disposable.ts'));

    // Trigger lazy check — GET should detect the file is gone
    const result = await cx.router.get(new URL('http://local/disposable.ts'));
    expect(result).toBeUndefined();

    // Disposer should have been called
    expect((globalThis as any).__lazy_disposed).toBe(true);

    // HTTP request should return 404
    expect(await requestJson(`http://127.0.0.1:${cx.options.port}/disposable.ts`)).toEqual({
      status: 404,
      body: { message: 'Not Found' },
    });
  });

  test('disposes and re-registers when file is replaced (deleted + recreated)', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);

    (globalThis as any).__lazy_dispose_count = 0;
    writeApi(
      dir,
      'replace.ts',
      `exports.default = { type: 0,
        handler: () => ({ version: 'a' }),
        disposer: () => { (globalThis as any).__lazy_dispose_count++; },
      };\n`,
    );
    await register(cx, 'replace.ts', fs.statSync(path.join(dir, 'replace.ts')));
    await startWorkerServer(cx);

    expect(await requestJson(`http://127.0.0.1:${cx.options.port}/replace.ts`)).toEqual({
      status: 200,
      body: { version: 'a' },
    });

    // Delete the file
    fs.rmSync(path.join(dir, 'replace.ts'));

    // GET after deletion — should trigger dispose
    expect(await cx.router.get(new URL('http://local/replace.ts'))).toBeUndefined();
    expect((globalThis as any).__lazy_dispose_count).toBe(1);

    // Recreate with different content
    writeApi(
      dir,
      'replace.ts',
      `exports.default = { type: 0,
        handler: () => ({ version: 'b' }),
        disposer: () => { (globalThis as any).__lazy_dispose_count++; },
      };\n`,
    );
    const statNew = fs.statSync(path.join(dir, 'replace.ts'));

    // GET should re-register the new file automatically
    const moduleNew = await cx.router.get(new URL('http://local/replace.ts'));
    expect(moduleNew).toBeDefined();
    expect(moduleNew!.mtimeMs).toBe(statNew.mtimeMs);

    // Now the new handler should respond
    expect(await requestJson(`http://127.0.0.1:${cx.options.port}/replace.ts`)).toEqual({
      status: 200,
      body: { version: 'b' },
    });
  });
});

describe('lazy route — dependency chain', () => {
  let tick = 0;
  // Rewrites a file with a guaranteed distinct mtime
  const rewrite = (dir: string, relativePath: string, body: string) => {
    writeApi(dir, relativePath, body);
    const t = new Date(Date.now() + 10_000 * ++tick);
    fs.utimesSync(path.join(dir, relativePath), t, t);
  };
  const handlerOf = (id: string, dep: string) =>
    `const dep = require('${dep}');\nexports.default = { type: 0, handler: () => ({ id: '${id}', dep: dep.value }) };\n`;
  const call = async (cx: FluxionContext, name: string) => {
    const m = await cx.router.get(new URL(`http://local/${name}`));
    return m && (m.handler as any)();
  };

  test('reloads handler when only a dependency changes', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);
    writeApi(dir, 'lib/dep.ts', "exports.value = 'v1';\n");
    writeApi(dir, 'a.ts', handlerOf('a', './lib/dep.ts'));
    await register(cx, 'a.ts', fs.statSync(path.join(dir, 'a.ts')));

    expect(await call(cx, 'a.ts')).toEqual({ id: 'a', dep: 'v1' });
    const before = await cx.router.get(new URL('http://local/a.ts'));
    expect(await cx.router.get(new URL('http://local/a.ts'))).toBe(before);

    rewrite(dir, 'lib/dep.ts', "exports.value = 'v2';\n");
    expect(await call(cx, 'a.ts')).toEqual({ id: 'a', dep: 'v2' });
  });

  test('reloads deep transitive dependency changes', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);
    writeApi(dir, 'lib/leaf.ts', "exports.value = 'leaf1';\n");
    writeApi(dir, 'lib/mid.ts', "exports.value = require('./leaf.ts').value;\n");
    writeApi(dir, 'a.ts', handlerOf('a', './lib/mid.ts'));
    await register(cx, 'a.ts', fs.statSync(path.join(dir, 'a.ts')));
    expect(await call(cx, 'a.ts')).toEqual({ id: 'a', dep: 'leaf1' });

    rewrite(dir, 'lib/leaf.ts', "exports.value = 'leaf2';\n");
    expect(await call(cx, 'a.ts')).toEqual({ id: 'a', dep: 'leaf2' });
  });

  test('handlers sharing a dependency all see the new version, with one shared instance', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);
    writeApi(dir, 'lib/shared.ts', 'exports.value = Math.random();\n');
    writeApi(dir, 'a.ts', handlerOf('a', './lib/shared.ts'));
    writeApi(dir, 'd.ts', handlerOf('d', './lib/shared.ts'));
    await register(cx, 'a.ts', fs.statSync(path.join(dir, 'a.ts')));
    await register(cx, 'd.ts', fs.statSync(path.join(dir, 'd.ts')));
    const first = await call(cx, 'a.ts');
    expect((await call(cx, 'd.ts')).dep).toBe(first.dep);

    rewrite(dir, 'lib/shared.ts', 'exports.value = Math.random();\n');
    const a = await call(cx, 'a.ts');
    const d = await call(cx, 'd.ts');
    expect(a.dep).not.toBe(first.dep);
    expect(d.dep).toBe(a.dep);

    // stable afterwards: no further reloads (no ping-pong between handlers)
    const ma = await cx.router.get(new URL('http://local/a.ts'));
    const md = await cx.router.get(new URL('http://local/d.ts'));
    expect(await cx.router.get(new URL('http://local/a.ts'))).toBe(ma);
    expect(await cx.router.get(new URL('http://local/d.ts'))).toBe(md);
    expect((await call(cx, 'a.ts')).dep).toBe(a.dep);
  });

  test('reloading a handler evicts intermediate modules that depend on its dependencies', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);
    writeApi(dir, 'lib/shared.ts', "exports.value = 's1';\n");
    writeApi(dir, 'lib/own.ts', "exports.value = 'own:' + require('./shared.ts').value;\n");
    writeApi(dir, 'a.ts', handlerOf('a', './lib/shared.ts'));
    writeApi(dir, 'd.ts', handlerOf('d', './lib/own.ts'));
    await register(cx, 'a.ts', fs.statSync(path.join(dir, 'a.ts')));
    await register(cx, 'd.ts', fs.statSync(path.join(dir, 'd.ts')));
    expect(await call(cx, 'd.ts')).toEqual({ id: 'd', dep: 'own:s1' });

    rewrite(dir, 'lib/shared.ts', "exports.value = 's2';\n");
    // a is requested first; d's private intermediate must not keep the old shared instance
    expect(await call(cx, 'a.ts')).toEqual({ id: 'a', dep: 's2' });
    // dependents are evicted eagerly, before d is requested again
    expect(require.cache[path.join(dir, 'lib/own.ts')]).toBeUndefined();
    expect(require.cache[path.join(dir, 'd.ts')]).toBeUndefined();
    expect(await call(cx, 'd.ts')).toEqual({ id: 'd', dep: 'own:s2' });
  });

  test('calls the previous disposer when a module is reloaded', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);
    (globalThis as any).__lazy_reload_disposed = [];
    const body = (v: string) =>
      `exports.default = { type: 0, handler: () => ({ v: '${v}' }), disposer: () => { (globalThis as any).__lazy_reload_disposed.push('${v}'); } };\n`;
    writeApi(dir, 'r.ts', body('1'));
    await register(cx, 'r.ts', fs.statSync(path.join(dir, 'r.ts')));

    rewrite(dir, 'r.ts', body('2'));
    expect(await call(cx, 'r.ts')).toEqual({ v: '2' });
    expect((globalThis as any).__lazy_reload_disposed).toEqual(['1']);
  });

  test('does not leave stale modules referenced after repeated reloads', async () => {
    const dir = makeTempDir();
    const cx = makeContext(dir);
    writeApi(dir, 'lib/dep.ts', "exports.value = 0;\n");
    writeApi(dir, 'a.ts', handlerOf('a', './lib/dep.ts'));
    await register(cx, 'a.ts', fs.statSync(path.join(dir, 'a.ts')));

    const refs = () =>
      Object.values(require.cache)
        .flatMap((m) => m?.children ?? [])
        .filter((c) => c.filename.startsWith(dir)).length;
    await call(cx, 'a.ts');
    const baseline = refs();
    for (let i = 1; i <= 5; i++) {
      rewrite(dir, 'lib/dep.ts', `exports.value = ${i};\n`);
      expect(await call(cx, 'a.ts')).toEqual({ id: 'a', dep: i });
    }
    expect(refs()).toBe(baseline);
  });
});
