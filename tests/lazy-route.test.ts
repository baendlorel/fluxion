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
    metaApis: ['healthz', 'version', 'stats', 'config'],
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