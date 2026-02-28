import http from 'node:http';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFileRuntime } from '@/core/file-runtime.js';

import {
  closeServer,
  createTempDirectory,
  listenEphemeral,
  removeDirectory,
  sleep,
  writeFile,
} from '../helpers/test-utils.js';

async function startRuntimeServer(dynamicDirectory: string): Promise<{ server: http.Server; baseUrl: string }> {
  const runtime = createFileRuntime(dynamicDirectory);

  const server = http.createServer((req, res) => {
    void runtime
      .handleRequest(req, res)
      .then((result) => {
        if (result === 'not_found') {
          res.statusCode = 404;
          res.end('not_found');
        }
      })
      .catch((error: unknown) => {
        res.statusCode = 500;
        res.end(String(error));
      });
  });

  const { baseUrl } = await listenEphemeral(server);
  return { server, baseUrl };
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
});
