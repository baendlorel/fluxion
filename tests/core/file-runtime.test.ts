import http from 'node:http';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  closeServer,
  createTempDirectory,
  listenEphemeral,
  removeDirectory,
  sleep,
  writeFile,
} from '../helpers/test-utils.js';
import { createFileRuntime } from '@/workers/file-runtime.js';
import type { FileRuntime, FileRuntimeOptions } from '@/workers/file-runtime.js';
import { HandlerResult } from '@/common/consts.js';

async function startRuntimeServer(
  dynamicDirectory: string,
  options?: FileRuntimeOptions,
): Promise<{ server: http.Server; baseUrl: string; runtime: FileRuntime }> {
  const runtime = createFileRuntime(dynamicDirectory, options);

  const server = http.createServer((req, res) => {
    void runtime
      .handleRequest(req, res)
      .then((result) => {
        if (result === HandlerResult.NotFound) {
          res.statusCode = 404;
          res.end('not_found');
        }
      })
      .catch((error: unknown) => {
        res.statusCode = 500;
        res.end(String(error));
      });
  });

  server.once('close', () => {
    void runtime.close();
  });

  const { baseUrl } = await listenEphemeral(server);
  return { server, baseUrl, runtime };
}

describe('file-runtime', () => {
  const tempDirectories: string[] = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();

    for (const server of servers.splice(0)) {
      await closeServer(server);
    }

    for (const tempDirectory of tempDirectories.splice(0)) {
      await removeDirectory(tempDirectory);
    }
  });

  it('prefers index.mjs over sibling .mjs handler', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-priority-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'aaa', 'bb', 'cc', 'index.mjs'),
      "export default function handler(_req, res) { res.end('from-index'); }",
    );
    await writeFile(
      path.join(dynamicDirectory, 'aaa', 'bb', 'cc.mjs'),
      "export default function handler(_req, res) { res.end('from-file'); }",
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory);
    servers.push(server);

    const response = await fetch(`${baseUrl}/aaa/bb/cc`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('from-index');
  });

  it('reloads handler when file mtime and size change', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-reload-');
    tempDirectories.push(dynamicDirectory);

    const handlerFile = path.join(dynamicDirectory, 'aaa', 'bb', 'cc.mjs');

    await writeFile(handlerFile, "export default function handler(_req, res) { res.end('v1'); }");

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory);
    servers.push(server);

    const firstResponse = await fetch(`${baseUrl}/aaa/bb/cc`);
    expect(await firstResponse.text()).toBe('v1');

    await sleep(20);
    await writeFile(handlerFile, "export default function handler(_req, res) { res.end('v2-reloaded'); }");

    const secondResponse = await fetch(`${baseUrl}/aaa/bb/cc`);
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.text()).toBe('v2-reloaded');
  });

  it('waits for callback-style async handlers to end the response', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-callback-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'delayed.mjs'),
      "export default function handler(_req, res) { setTimeout(() => res.end('delayed-ok'), 20); }",
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory);
    servers.push(server);

    const response = await fetch(`${baseUrl}/delayed`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('delayed-ok');
  });

  it('serializes handler return value as json response', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-return-json-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'return-json.mjs'),
      [
        'export default async function handler() {',
        '  return { ok: true, count: 1 };',
        '}',
      ].join('\n'),
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory);
    servers.push(server);

    const response = await fetch(`${baseUrl}/return-json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect((await response.json()) as Record<string, unknown>).toEqual({ ok: true, count: 1 });
  });

  it('serves static .js files and blocks underscore directories', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-static-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(path.join(dynamicDirectory, 'assets', 'app.js'), "console.log('app');");
    await writeFile(
      path.join(dynamicDirectory, '_lib', 'ping.mjs'),
      "export default function handler(_req, res) { res.end('hidden'); }",
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory);
    servers.push(server);

    const staticResponse = await fetch(`${baseUrl}/assets/app.js`);
    expect(staticResponse.status).toBe(200);
    expect(await staticResponse.text()).toContain("console.log('app')");
    expect(staticResponse.headers.get('content-type')).toContain('text/javascript');

    const hiddenHandlerResponse = await fetch(`${baseUrl}/_lib/ping`);
    expect(hiddenHandlerResponse.status).toBe(404);
    expect(await hiddenHandlerResponse.text()).toBe('not_found');

    const hiddenStaticResponse = await fetch(`${baseUrl}/_lib/ping.mjs`);
    expect(hiddenStaticResponse.status).toBe(404);
    expect(await hiddenStaticResponse.text()).toBe('not_found');
  });

  it('falls back to route index.html when direct file is not matched', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-static-index-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'docs', 'index.html'),
      '<html><body><h1>docs-home</h1></body></html>',
    );
    await writeFile(
      path.join(dynamicDirectory, 'index.html'),
      '<html><body><h1>root-home</h1></body></html>',
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory);
    servers.push(server);

    const docsResponse = await fetch(`${baseUrl}/docs`);
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.headers.get('content-type')).toContain('text/html');
    expect(await docsResponse.text()).toContain('docs-home');

    const rootResponse = await fetch(`${baseUrl}/`);
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.headers.get('content-type')).toContain('text/html');
    expect(await rootResponse.text()).toContain('root-home');
  });

  it('creates route snapshot from .mjs handlers and static files', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-snapshot-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'aaa', 'bb', 'cc', 'index.mjs'),
      "export default function handler(_req, res) { res.end('from-index'); }",
    );
    await writeFile(
      path.join(dynamicDirectory, 'aaa', 'bb', 'cc.mjs'),
      "export default function handler(_req, res) { res.end('from-file'); }",
    );
    await writeFile(path.join(dynamicDirectory, 'public', 'app.js'), "console.log('app');");
    await writeFile(path.join(dynamicDirectory, '_lib', 'internal.mjs'), 'export default () => {};');

    const runtime = createFileRuntime(dynamicDirectory);
    const snapshot = await runtime.getRouteSnapshot();

    expect(snapshot.handlers).toEqual([
      {
        route: '/aaa/bb/cc',
        file: 'aaa/bb/cc/index.mjs',
        version: expect.stringContaining(':'),
      },
    ]);

    expect(snapshot.staticFiles).toContainEqual({
      route: '/public/app.js',
      file: 'public/app.js',
      version: expect.stringContaining(':'),
    });

    expect(snapshot.handlers.some((item) => item.file.includes('_lib'))).toBe(false);
    expect(snapshot.staticFiles.some((item) => item.file.includes('_lib'))).toBe(false);
  });

  it('supports object-style default export and passes handler context', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-context-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'ctx.mjs'),
      [
        'export default {',
        '  handler(_req, res, context) {',
        "    res.setHeader('x-worker-id', context.worker.id);",
        "    res.end(typeof context.worker?.id === 'string' ? 'context-ok' : 'context-missing');",
        '  },',
        '};',
      ].join('\n'),
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory);
    servers.push(server);

    const response = await fetch(`${baseUrl}/ctx`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('context-ok');
    expect(response.headers.get('x-worker-id')).toContain('fluxion-worker-all');
  });

  it('injects module instances into context via modules declarations', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-db-config-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'dbctx.mjs'),
      [
        'export default {',
        '  modules: [',
        '    {',
        "      module: 'node:crypto',",
        "      injectKey: 'mydb',",
        '      factory: (cryptoModule) => {',
        '        return {',
        '          query(sql) {',
        "            return cryptoModule.createHash('sha1').update(String(sql)).digest('hex');",
        '          },',
        '        };',
        '      },',
        '    },',
        '  ],',
        '  handler(_req, res, context) {',
        "    const ready = typeof context.mydb?.query === 'function';",
        "    const sample = ready ? context.mydb.query('select 1') : '';",
        "    res.setHeader('x-ready', String(ready));",
        '    res.end(ready && sample.length > 0 ? "module-connected" : "module-missing");',
        '  },',
        '};',
      ].join('\n'),
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory);
    servers.push(server);

    const response = await fetch(`${baseUrl}/dbctx`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('module-connected');
    expect(response.headers.get('x-ready')).toBe('true');
  });

  it('rejects legacy handler-level db declaration', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-db-shape-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'invalid-db-shape.mjs'),
      [
        'export default {',
        "  db: ['main'],",
        '  handler(_req, res) {',
        "    res.end('never');",
        '  },',
        '};',
      ].join('\n'),
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory);
    servers.push(server);

    const response = await fetch(`${baseUrl}/invalid-db-shape`);
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('Legacy db declaration is no longer supported');
  });

  it('rejects modules declaration when injectKey is reserved', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-module-reserved-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'invalid-inject-key.mjs'),
      [
        'export default {',
        '  modules: [',
        '    {',
        "      module: 'node:crypto',",
        "      injectKey: 'worker',",
        '      factory: () => ({})',
        '    },',
        '  ],',
        '  handler(_req, res) {',
        "    res.end('never');",
        '  },',
        '};',
      ].join('\n'),
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory);
    servers.push(server);

    const response = await fetch(`${baseUrl}/invalid-inject-key`);
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('injectKey "worker" is reserved');
  });

  it('fails request when worker response exceeds maxResponseBytes', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-res-size-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'large.mjs'),
      "export default function handler(_req, res) { res.end('0123456789'.repeat(40)); }",
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory, {
      workerOptions: {
        maxResponseBytes: 128,
      },
    });
    servers.push(server);

    const response = await fetch(`${baseUrl}/large`);
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('worker response too large');
  });
});
