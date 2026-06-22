import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

import axios, { type AxiosInstance } from 'axios';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createTempDirectory, removeDirectory, waitFor, writeFile } from '../helpers/test-utils.js';

interface RunningFluxionApp {
  businessPort: number;
  metaPort: number;
  process: ChildProcessWithoutNullStreams;
  businessClient: AxiosInstance;
  metaClient: AxiosInstance;
  logs: string[];
  stop: () => Promise<void>;
}

const runningApps: RunningFluxionApp[] = [];
const tempDirectories: string[] = [];
const packageRoot = path.resolve(__dirname, '../..');
const distEntry = path.join(packageRoot, 'dist', 'index.mjs');

function spawnCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${output}`));
    });
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to resolve free port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function getPortPair(): Promise<{ businessPort: number; metaPort: number }> {
  for (let i = 0; i < 30; i++) {
    const businessPort = await getFreePort();
    const metaPort = businessPort + 1;
    if (metaPort > 65535) {
      continue;
    }
    if (await isPortFree(metaPort)) {
      return { businessPort, metaPort };
    }
  }
  throw new Error('Failed to allocate business/meta port pair');
}

async function startFluxionApp(options: {
  dynamicDirectory: string;
  businessPort: number;
  metaPort?: number;
  maxWorkerCount?: number;
}): Promise<RunningFluxionApp> {
  const appDirectory = await createTempDirectory('fluxion-e2e-app-');
  tempDirectories.push(appDirectory);

  const scriptPath = path.join(appDirectory, 'app.mjs');
  const scriptLines = [
    `import { fluxion } from ${JSON.stringify(distEntry)};`,
    'fluxion({',
    `  dir: ${JSON.stringify(options.dynamicDirectory)},`,
    "  host: '127.0.0.1',",
    `  port: ${options.businessPort},`,
    options.metaPort === undefined ? '' : `  metaPort: ${options.metaPort},`,
    options.maxWorkerCount === undefined ? '' : `  workerOptions: { maxWorkerCount: ${options.maxWorkerCount} },`,
    '});',
  ].filter((line) => line.length > 0);
  await writeFile(scriptPath, scriptLines.join('\n'));

  const child = spawn(process.execPath, [scriptPath], {
    cwd: appDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs: string[] = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  const businessClient = axios.create({
    baseURL: `http://127.0.0.1:${options.businessPort}`,
    timeout: 5000,
    validateStatus: () => true,
    proxy: false,
  });

  const resolvedMetaPort = options.metaPort ?? options.businessPort + 1;
  const metaClient = axios.create({
    baseURL: `http://127.0.0.1:${resolvedMetaPort}`,
    timeout: 5000,
    validateStatus: () => true,
    proxy: false,
  });

  const app: RunningFluxionApp = {
    businessPort: options.businessPort,
    metaPort: resolvedMetaPort,
    process: child,
    businessClient,
    metaClient,
    logs,
    stop: async () => {
      if (child.exitCode !== null || child.killed) {
        return;
      }
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 4000);
        timer.unref();
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };

  runningApps.push(app);

  try {
    await waitFor(
      async () => {
        if (child.exitCode !== null) {
          throw new Error(`Fluxion process exited early (code=${child.exitCode})\n${logs.join('')}`);
        }
        try {
          const response = await metaClient.get('/_fluxion/healthz');
          return response.status === 200 && response.data?.ok === true;
        } catch {
          return false;
        }
      },
      10000,
      100,
    );
  } catch (error) {
    await app.stop();
    throw new Error(`Failed to start fluxion app: ${(error as Error).message}\n${logs.join('')}`);
  }

  return app;
}

describe('fluxion e2e (cluster runtime)', () => {
  beforeAll(async () => {
    await spawnCommand('pnpm', ['build'], packageRoot);
  });

  afterEach(async () => {
    for (const app of runningApps.splice(0)) {
      await app.stop();
    }

    for (const directory of tempDirectories.splice(0)) {
      await removeDirectory(directory);
    }
  });

  it('starts primary + workers and exposes worker telemetry on meta api', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-cluster-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'hello.mjs'),
      'export default function handler() { return { ok: true, workerPid: process.pid }; }',
    );

    const { businessPort, metaPort } = await getPortPair();
    const app = await startFluxionApp({
      dynamicDirectory,
      businessPort,
      metaPort,
      maxWorkerCount: 2,
    });

    const healthzResponse = await app.metaClient.get('/_fluxion/healthz');
    expect(healthzResponse.status).toBe(200);
    expect(healthzResponse.data?.ok).toBe(true);
    expect(healthzResponse.data?.role).toBe('primary');

    await waitFor(
      async () => {
        const response = await app.metaClient.get('/_fluxion/workers');
        const workers = response.data?.workers?.workers;
        return (
          Array.isArray(workers) &&
          workers.length === 2 &&
          workers.every((worker: any) => worker.state === 'ready' && worker.stats !== null)
        );
      },
      12000,
      200,
    );

    const workersResponse = await app.metaClient.get('/_fluxion/workers');
    const workers = workersResponse.data.workers.workers;
    expect(workersResponse.status).toBe(200);
    expect(workersResponse.data.workers.metaPort).toBe(metaPort);
    expect(workers.every((worker: any) => worker.stats.cpu.percent >= 0)).toBe(true);
    expect(workers.every((worker: any) => worker.stats.memory.rss > 0)).toBe(true);

    const businessResponse = await app.businessClient.get('/hello');
    expect(businessResponse.status).toBe(200);
    expect(businessResponse.data.ok).toBe(true);
    expect(typeof businessResponse.data.workerPid).toBe('number');
    expect(businessResponse.data.workerPid).not.toBe(healthzResponse.data.pid);
  });

  it('uses default metaPort = port + 1 and redirects meta path usage on business port', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-meta-default-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(
      path.join(dynamicDirectory, 'ping.mjs'),
      'export default function handler() { return { pong: true }; }',
    );

    const { businessPort, metaPort } = await getPortPair();
    const app = await startFluxionApp({
      dynamicDirectory,
      businessPort,
      maxWorkerCount: 1,
    });

    expect(app.metaPort).toBe(metaPort);

    const healthzResponse = await app.metaClient.get('/_fluxion/healthz');
    expect(healthzResponse.status).toBe(200);
    expect(healthzResponse.data?.ok).toBe(true);

    const wrongPortMetaResponse = await app.businessClient.get('/_fluxion/healthz');
    expect(wrongPortMetaResponse.status).toBe(404);
    expect(wrongPortMetaResponse.data?.message).toContain(String(metaPort));

    const pingResponse = await app.businessClient.get('/ping');
    expect(pingResponse.status).toBe(200);
    expect(pingResponse.data).toMatchObject({ pong: true });
  });

  it('serves static files with GET/HEAD and rejects unsupported methods', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-e2e-static-');
    tempDirectories.push(dynamicDirectory);

    await writeFile(path.join(dynamicDirectory, 'assets', 'app.js'), "console.log('static-ok');");

    const { businessPort, metaPort } = await getPortPair();
    const app = await startFluxionApp({
      dynamicDirectory,
      businessPort,
      metaPort,
      maxWorkerCount: 1,
    });

    const getResponse = await app.businessClient.get('/assets/app.js');
    expect(getResponse.status).toBe(200);
    expect(getResponse.data).toContain('static-ok');
    expect(String(getResponse.headers['content-type'])).toContain('text/javascript');

    const headResponse = await app.businessClient.head('/assets/app.js');
    expect(headResponse.status).toBe(200);
    expect(Number(headResponse.headers['content-length'])).toBeGreaterThan(0);

    const postResponse = await app.businessClient.post('/assets/app.js', { a: 1 });
    expect(postResponse.status).toBe(405);
    expect(postResponse.headers['allow']).toBe('GET, HEAD');
  });
});
