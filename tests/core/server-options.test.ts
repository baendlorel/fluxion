import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fluxion } from '@/core/server.js';

import { closeServer, createTempDirectory, removeDirectory, writeFile } from '../helpers/test-utils.js';

async function startServer(dynamicDirectory: string, maxRequestBytes: number): Promise<{ server: http.Server; baseUrl: string }> {
  const server = fluxion({
    dir: dynamicDirectory,
    host: '127.0.0.1',
    port: 0,
    maxRequestBytes,
  });

  if (!server.listening) {
    await once(server, 'listening');
  }

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to resolve server address');
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe('server options', () => {
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

  it('enforces maxRequestBytes and returns 413 for oversized body', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-server-max-body-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'echo.mjs'),
      [
        'export default function handler(req, res) {',
        '  const chunks = [];',
        "  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));",
        "  req.on('end', () => res.end(String(Buffer.concat(chunks).byteLength)));",
        '}',
      ].join('\n'),
    );

    const { server, baseUrl } = await startServer(dynamicDirectory, 8);
    servers.push(server);

    const oversizedResponse = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      body: '123456789',
      headers: {
        'content-type': 'text/plain',
      },
    });

    expect(oversizedResponse.status).toBe(413);

    const oversizedPayload = (await oversizedResponse.json()) as { message?: string };
    expect(oversizedPayload.message).toContain('request body too large');

    const okResponse = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      body: '12345',
      headers: {
        'content-type': 'text/plain',
      },
    });

    expect(okResponse.status).toBe(200);
    expect(await okResponse.text()).toBe('5');
  });

  it('rejects invalid maxRequestBytes at startup', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-server-max-body-invalid-');
    tempDirectories.push(dynamicDirectory);

    expect(() =>
      fluxion({
        dir: dynamicDirectory,
        host: '127.0.0.1',
        port: 0,
        maxRequestBytes: 0,
      }),
    ).toThrow('Invalid maxRequestBytes');
  });
});
