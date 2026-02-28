import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import axios, { type AxiosInstance } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startServer } from '@/core/server.js';

import { createTarBuffer } from '../helpers/archive-utils.js';
import {
  closeServer,
  createTempDirectory,
  removeDirectory,
  sleep,
  waitFor,
  writeFile,
} from '../helpers/test-utils.js';

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

  it('loads startup module and resolves nested handler path', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-startup-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'aaa', 'server', 'bb', 'cc', 'index.js'),
      "export default function handler(_req, res) { res.end('startup-ok'); }",
    );

    const { server, client } = await startFluxion(dynamicDirectory);
    servers.push(server);

    const nestedResponse = await client.get('/aaa/bb/cc');
    expect(nestedResponse.status).toBe(200);
    expect(nestedResponse.data).toBe('startup-ok');

    const routesResponse = await client.get('/_fluxion/routes');
    expect(routesResponse.status).toBe(200);
    expect(routesResponse.data).toMatchObject({
      routes: {
        modules: [
          {
            moduleName: 'aaa',
            rootPath: '/aaa',
            wildcardPath: '/aaa/*',
          },
        ],
      },
    });

    const healthzResponse = await client.get('/_fluxion/healthz');
    expect(healthzResponse.status).toBe(200);
    expect(healthzResponse.data?.ok).toBe(true);

    const missingModuleResponse = await client.get('/missing/path');
    expect(missingModuleResponse.status).toBe(404);
    expect(missingModuleResponse.data).toMatchObject({
      message: 'Route not found',
    });
  });

  it('mounts added module and unmounts removed module via directory watcher', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-watch-');
    tempDirectories.push(dynamicDirectory);

    const { server, client } = await startFluxion(dynamicDirectory);
    servers.push(server);

    await writeFile(
      path.join(dynamicDirectory, 'bbb', 'server', 'hello.js'),
      "export default function handler(_req, res) { res.end('watch-mounted'); }",
    );

    await waitFor(async () => {
      const response = await client.get('/bbb/hello');
      return response.status === 200 && response.data === 'watch-mounted';
    });

    await fs.rm(path.join(dynamicDirectory, 'bbb'), { recursive: true, force: true });

    await waitFor(async () => {
      const response = await client.get('/bbb/hello');
      return response.status === 404 && response.data?.message === 'Route not found';
    });
  });

  it('hot reloads handler by mtime+size and returns 500 for invalid default export', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-reload-');
    tempDirectories.push(dynamicDirectory);

    const handlerFile = path.join(dynamicDirectory, 'ccc', 'server', 'task.js');

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

  it('uploads flat tar archive and mounts it as archive-name module', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-upload-flat-');
    tempDirectories.push(dynamicDirectory);

    const { server, client } = await startFluxion(dynamicDirectory);
    servers.push(server);

    const archiveBuffer = await createTarBuffer({
      'web/index.html': '<h1>tar</h1>',
      'server/hello.js': "export default function handler(_req, res) { res.end('tar-upload-ok'); }",
    });

    const uploadResponse = await client.post('/_fluxion/upload?filename=tar-demo.tar', archiveBuffer, {
      headers: {
        'content-type': 'application/octet-stream',
      },
    });

    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.data).toMatchObject({
      module: 'tar-demo',
      layout: 'flat',
    });

    const routeResponse = await client.get('/tar-demo/hello');
    expect(routeResponse.status).toBe(200);
    expect(routeResponse.data).toBe('tar-upload-ok');
  });

  it('uploads nested tar archive, mounts folder module, and rejects invalid archive', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-upload-nested-');
    tempDirectories.push(dynamicDirectory);

    const { server, client } = await startFluxion(dynamicDirectory);
    servers.push(server);

    const nestedArchive = await createTarBuffer({
      'tar-module/web/index.html': '<h1>tar</h1>',
      'tar-module/server/ping.js': "export default function handler(_req, res) { res.end('tar-upload-ok'); }",
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

    const routeResponse = await client.get('/tar-module/ping');
    expect(routeResponse.status).toBe(200);
    expect(routeResponse.data).toBe('tar-upload-ok');

    const invalidArchive = await createTarBuffer({
      'foo.txt': 'broken',
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
