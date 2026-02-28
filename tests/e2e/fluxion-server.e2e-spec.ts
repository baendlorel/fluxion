import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import axios, { type AxiosInstance } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startServer } from '@/core/server.js';

import { createTarBuffer } from '../helpers/archive-utils.js';
import { closeServer, createTempDirectory, removeDirectory, sleep, waitFor, writeFile } from '../helpers/test-utils.js';

async function startFluxion(dynamicDirectory: string): Promise<{ server: http.Server; client: AxiosInstance }> {
  const server = startServer({
    dynamicDirectory,
    host: '127.0.0.1',
    port: 0,
  });

  if (!server.listening) {
    await once(server, 'listening');
  }

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to resolve server address');
  }

  const baseURL = `http://127.0.0.1:${address.port}`;

  const client = axios.create({
    baseURL,
    timeout: 2500,
    validateStatus: () => true,
    proxy: false,
  });

  return { server, client };
}

describe('fluxion e2e', () => {
  const tempDirectories: string[] = [];
  const servers: http.Server[] = [];

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await closeServer(server);
    }

    for (const tempDirectory of tempDirectories.splice(0)) {
      await removeDirectory(tempDirectory);
    }

    vi.restoreAllMocks();
  });

  it('loads startup routes, serves static files, and exposes meta apis', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-startup-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'aaa', 'bb', 'cc', 'index.mjs'),
      "export default function handler(_req, res) { res.end('startup-ok'); }",
    );
    await writeFile(path.join(dynamicDirectory, 'aaa', 'public', 'app.js'), "console.log('startup');");

    const { server, client } = await startFluxion(dynamicDirectory);
    servers.push(server);

    const nestedResponse = await client.get('/aaa/bb/cc');
    expect(nestedResponse.status).toBe(200);
    expect(nestedResponse.data).toBe('startup-ok');

    const staticResponse = await client.get('/aaa/public/app.js');
    expect(staticResponse.status).toBe(200);
    expect(staticResponse.data).toContain("console.log('startup')");

    const routesResponse = await client.get('/_fluxion/routes');
    expect(routesResponse.status).toBe(200);
    expect(routesResponse.data).toMatchObject({
      routes: {
        handlers: [
          {
            route: '/aaa/bb/cc',
            file: 'aaa/bb/cc/index.mjs',
          },
        ],
      },
    });
    expect(
      routesResponse.data.routes.staticFiles.some(
        (item: { route: string; file: string }) => item.route === '/aaa/public/app.js' && item.file === 'aaa/public/app.js',
      ),
    ).toBe(true);

    const healthzResponse = await client.get('/_fluxion/healthz');
    expect(healthzResponse.status).toBe(200);
    expect(healthzResponse.data?.ok).toBe(true);

    const missingRouteResponse = await client.get('/missing/path');
    expect(missingRouteResponse.status).toBe(404);
    expect(missingRouteResponse.data).toMatchObject({
      message: 'Route not found',
    });
  });

  it('reflects route add and remove by file changes', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-add-remove-');
    tempDirectories.push(dynamicDirectory);

    const { server, client } = await startFluxion(dynamicDirectory);
    servers.push(server);

    await writeFile(
      path.join(dynamicDirectory, 'bbb', 'hello.mjs'),
      "export default function handler(_req, res) { res.end('watch-mounted'); }",
    );

    await waitFor(async () => {
      const response = await client.get('/bbb/hello');
      return response.status === 200 && response.data === 'watch-mounted';
    });

    const routesAfterAdd = await client.get('/_fluxion/routes');
    expect(
      routesAfterAdd.data.routes.handlers.some(
        (item: { route: string; file: string }) => item.route === '/bbb/hello' && item.file === 'bbb/hello.mjs',
      ),
    ).toBe(true);

    await fs.rm(path.join(dynamicDirectory, 'bbb', 'hello.mjs'), { force: true });

    await waitFor(async () => {
      const response = await client.get('/bbb/hello');
      return response.status === 404 && response.data?.message === 'Route not found';
    });

    const routesAfterRemove = await client.get('/_fluxion/routes');
    expect(routesAfterRemove.data.routes.handlers.some((item: { route: string }) => item.route === '/bbb/hello')).toBe(
      false,
    );
  });

  it('hot reloads mjs handler by mtime+size and returns 500 for invalid default export', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-reload-');
    tempDirectories.push(dynamicDirectory);

    const handlerFile = path.join(dynamicDirectory, 'ccc', 'task.mjs');

    await writeFile(handlerFile, "export default function handler(_req, res) { res.end('v1'); }");

    const { server, client } = await startFluxion(dynamicDirectory);
    servers.push(server);

    const firstResponse = await client.get('/ccc/task');
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.data).toBe('v1');

    await sleep(20);
    await writeFile(handlerFile, "export default function handler(_req, res) { res.end('v2-hot'); }");

    await waitFor(async () => {
      const response = await client.get('/ccc/task');
      return response.status === 200 && response.data === 'v2-hot';
    });

    await sleep(20);
    await writeFile(handlerFile, 'export default { broken: true };');

    await waitFor(async () => {
      const response = await client.get('/ccc/task');
      return response.status === 500 && response.data?.message === 'Internal Server Error';
    });
  });

  it('blocks routing for underscore-prefixed directories', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-underscore-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, '_lib', 'secret.mjs'),
      "export default function handler(_req, res) { res.end('hidden'); }",
    );
    await writeFile(path.join(dynamicDirectory, '_lib', 'tool.js'), "console.log('hidden-tool');");
    await writeFile(
      path.join(dynamicDirectory, 'public', 'ping.mjs'),
      "export default function handler(_req, res) { res.end('public-ok'); }",
    );

    const { server, client } = await startFluxion(dynamicDirectory);
    servers.push(server);

    const publicResponse = await client.get('/public/ping');
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.data).toBe('public-ok');

    const hiddenHandlerResponse = await client.get('/_lib/secret');
    expect(hiddenHandlerResponse.status).toBe(404);

    const hiddenStaticResponse = await client.get('/_lib/tool.js');
    expect(hiddenStaticResponse.status).toBe(404);

    const routesResponse = await client.get('/_fluxion/routes');
    const hasHiddenRoute =
      routesResponse.data.routes.handlers.some((item: { file: string }) => item.file.startsWith('_lib/')) ||
      routesResponse.data.routes.staticFiles.some((item: { file: string }) => item.file.startsWith('_lib/'));

    expect(hasHiddenRoute).toBe(false);
  });

  it('uploads tar archives and handles invalid upload payloads', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-upload-');
    tempDirectories.push(dynamicDirectory);

    const { server, client } = await startFluxion(dynamicDirectory);
    servers.push(server);

    const flatArchive = await createTarBuffer({
      'ping.mjs': "export default function handler(_req, res) { res.end('flat-upload-ok'); }",
      'public/app.js': "console.log('flat');",
    });

    const flatUploadResponse = await client.post('/_fluxion/upload?filename=tar-demo.tar', flatArchive, {
      headers: {
        'content-type': 'application/octet-stream',
      },
    });

    expect(flatUploadResponse.status).toBe(200);
    expect(flatUploadResponse.data).toMatchObject({
      module: 'tar-demo',
      layout: 'flat',
    });

    const flatRouteResponse = await client.get('/tar-demo/ping');
    expect(flatRouteResponse.status).toBe(200);
    expect(flatRouteResponse.data).toBe('flat-upload-ok');

    const nestedArchive = await createTarBuffer({
      'tar-module/ping.mjs': "export default function handler(_req, res) { res.end('nested-upload-ok'); }",
    });

    const nestedUploadResponse = await client.post('/_fluxion/upload?filename=anything.tar', nestedArchive, {
      headers: {
        'content-type': 'application/octet-stream',
      },
    });

    expect(nestedUploadResponse.status).toBe(200);
    expect(nestedUploadResponse.data).toMatchObject({
      module: 'tar-module',
      layout: 'nested',
    });

    const nestedRouteResponse = await client.get('/tar-module/ping');
    expect(nestedRouteResponse.status).toBe(200);
    expect(nestedRouteResponse.data).toBe('nested-upload-ok');

    const invalidArchive = await createTarBuffer({
      '__MACOSX/.DS_Store': 'broken',
    });

    const invalidUploadResponse = await client.post('/_fluxion/upload?filename=broken.tar', invalidArchive, {
      headers: {
        'content-type': 'application/octet-stream',
      },
    });

    expect(invalidUploadResponse.status).toBe(400);
    expect(invalidUploadResponse.data?.message).toContain('Invalid archive structure');

    const unsupportedUploadResponse = await client.post('/_fluxion/upload?filename=broken.zip', invalidArchive, {
      headers: {
        'content-type': 'application/octet-stream',
      },
    });

    expect(unsupportedUploadResponse.status).toBe(400);
    expect(unsupportedUploadResponse.data?.message).toContain('Unsupported archive format');
  });
});
