import http from 'node:http';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createModuleHandlerRuntime } from '@/core/module-handler-runtime.js';

import {
  closeServer,
  createTempDirectory,
  listenEphemeral,
  removeDirectory,
  sleep,
  writeFile,
} from '../helpers/test-utils.js';

async function startRuntimeServer(dynamicDirectory: string, moduleName: string): Promise<{ server: http.Server; baseUrl: string }> {
  const runtime = createModuleHandlerRuntime(dynamicDirectory);

  const server = http.createServer((req, res) => {
    void runtime
      .handleRequest(moduleName, req, res)
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

describe('module-handler-runtime', () => {
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

  it('prefers index.js over sibling .js handler', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-priority-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'aaa', 'server', 'bb', 'cc', 'index.js'),
      "export default function handler(_req, res) { res.end('from-index'); }",
    );
    await writeFile(
      path.join(dynamicDirectory, 'aaa', 'server', 'bb', 'cc.js'),
      "export default function handler(_req, res) { res.end('from-file'); }",
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory, 'aaa');
    servers.push(server);

    const response = await fetch(`${baseUrl}/aaa/bb/cc`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('from-index');
  });

  it('reloads handler when file mtime and size change', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-reload-');
    tempDirectories.push(dynamicDirectory);

    const handlerFile = path.join(dynamicDirectory, 'aaa', 'server', 'bb', 'cc.js');

    await writeFile(handlerFile, "export default function handler(_req, res) { res.end('v1'); }");

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory, 'aaa');
    servers.push(server);

    const firstResponse = await fetch(`${baseUrl}/aaa/bb/cc`);
    expect(await firstResponse.text()).toBe('v1');

    await sleep(20);
    await writeFile(handlerFile, "export default function handler(_req, res) { res.end('v2-reloaded'); }");

    const secondResponse = await fetch(`${baseUrl}/aaa/bb/cc`);
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.text()).toBe('v2-reloaded');
  });

  it('returns not_found for missing handler and unsafe path segments', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-runtime-not-found-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'aaa', 'server', 'index.js'),
      "export default function handler(_req, res) { res.end('root-handler'); }",
    );

    const { server, baseUrl } = await startRuntimeServer(dynamicDirectory, 'aaa');
    servers.push(server);

    const missingResponse = await fetch(`${baseUrl}/aaa/not-exists`);
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.text()).toBe('not_found');

    const unsafeResponse = await fetch(`${baseUrl}/aaa/%2e%2e/secret`);
    expect(unsafeResponse.status).toBe(404);
    expect(await unsafeResponse.text()).toBe('not_found');
  });
});
