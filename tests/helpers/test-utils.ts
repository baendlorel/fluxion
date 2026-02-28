import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export async function createTempDirectory(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeDirectory(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function writeFile(targetPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, 'utf8');
}

export async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000, stepMs = 50): Promise<void> {
  const startAt = Date.now();

  while (Date.now() - startAt <= timeoutMs) {
    if (await predicate()) {
      return;
    }

    await sleep(stepMs);
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function listenEphemeral(server: http.Server, host = '127.0.0.1'): Promise<{ host: string; port: number; baseUrl: string }> {
  server.listen(0, host);

  if (!server.listening) {
    await once(server, 'listening');
  }

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Failed to resolve server address');
  }

  return {
    host,
    port: address.port,
    baseUrl: `http://${host}:${address.port}`,
  };
}

export async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
