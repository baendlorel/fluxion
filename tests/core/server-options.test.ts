import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fluxion } from '@/core/server.js';
import type { FluxionDatabaseInput } from '@/core/server.js';
import type { LogEntry, LoggerOption } from '@/common/logger.js';

import { closeServer, createTempDirectory, removeDirectory, writeFile } from '../helpers/test-utils.js';

interface StartServerOptions {
  maxRequestBytes?: number;
  logger?: LoggerOption;
  databases?: FluxionDatabaseInput[];
  dbConfigPath?: string;
}

async function startServer(
  dynamicDirectory: string,
  options: StartServerOptions = {},
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = fluxion({
    dir: dynamicDirectory,
    host: '127.0.0.1',
    port: 0,
    maxRequestBytes: options.maxRequestBytes,
    logger: options.logger,
    databases: options.databases,
    dbConfigPath: options.dbConfigPath,
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
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
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

    const { server, baseUrl } = await startServer(dynamicDirectory, { maxRequestBytes: 8 });
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

  it('loads db config from private file path', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-server-db-config-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'ctx.mjs'),
      [
        'export default {',
        '  handler(_req, res, context) {',
        "    const ready = typeof context.worker?.id === 'string';",
        "    res.end(ready ? 'worker-ready' : 'worker-missing');",
        '  },',
        '};',
      ].join('\n'),
    );

    const privateConfigPath = path.join(dynamicDirectory, '.fluxion-private', 'db.config.cjs');
    await writeFile(
      privateConfigPath,
      [
        'module.exports = {',
        "  main: {",
        "    driver: 'pg',",
        '    options: {},',
        '  },',
        '};',
      ].join('\n'),
    );

    const { server, baseUrl } = await startServer(dynamicDirectory, {
      dbConfigPath: privateConfigPath,
    });
    servers.push(server);

    const response = await fetch(`${baseUrl}/ctx`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('worker-ready');
  });

  it('supports json-line logger mode', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-server-logger-json-');
    tempDirectories.push(dynamicDirectory);

    const { server, baseUrl } = await startServer(dynamicDirectory, { logger: 'json-line' });
    servers.push(server);

    await fetch(`${baseUrl}/missing`);

    const lines = consoleLogSpy.mock.calls
      .map((call: unknown[]) => call[0])
      .filter((value: unknown): value is string => typeof value === 'string');
    expect(lines.length).toBeGreaterThan(0);

    const entries = lines.map((line: string) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.some((entry: Record<string, unknown>) => entry.event === 'ServerStarted')).toBe(true);
    expect(entries.some((entry: Record<string, unknown>) => entry.event === 'RequestCompleted')).toBe(true);
  });

  it('supports custom logger function', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-server-logger-custom-');
    tempDirectories.push(dynamicDirectory);

    const entries: LogEntry[] = [];

    const { server, baseUrl } = await startServer(dynamicDirectory, {
      logger(entry) {
        entries.push(entry);
      },
    });
    servers.push(server);

    await fetch(`${baseUrl}/missing`);

    expect(entries.some((entry) => entry.event === 'ServerStarted')).toBe(true);
    expect(entries.some((entry) => entry.event === 'RequestCompleted')).toBe(true);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
