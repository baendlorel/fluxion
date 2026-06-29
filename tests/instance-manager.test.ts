import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('FluxionInstanceManager', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    originalHome = process.env.HOME;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxion-home-'));
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('escalates from SIGTERM to SIGKILL when an old primary does not exit in time', async () => {
    const duplicatePid = 4242;
    const currentPid = process.pid;
    const instanceFilePath = path.join(tempHome, '.fluxion', 'instances.json');

    fs.mkdirSync(path.dirname(instanceFilePath), { recursive: true });
    fs.writeFileSync(
      instanceFilePath,
      JSON.stringify({
        instances: [
          {
            startTime: Date.now() - 1000,
            pid: duplicatePid,
            host: '127.0.0.1',
            port: 3000,
            metaPort: 3001,
            cwd: '/tmp/old-instance',
            configPath: '/tmp/fluxion.config.ts',
          },
        ],
      }),
    );

    let oldProcessForceKilled = false;
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(((
      pid: number,
      signal?: number | NodeJS.Signals,
    ) => {
      if (signal === 0) {
        if (pid === currentPid) {
          return true;
        }

        if (pid === duplicatePid && !oldProcessForceKilled) {
          return true;
        }

        const error = new Error('ESRCH') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }

      if (pid === duplicatePid && signal === 'SIGTERM') {
        return true;
      }

      if (pid === duplicatePid && signal === 'SIGKILL') {
        oldProcessForceKilled = true;
        return true;
      }

      return true;
    }) as typeof process.kill);

    const { FluxionInstanceManager } = await import('../src/cluster/launcher.js');
    const manager = new FluxionInstanceManager();

    const registerPromise = manager.register('/tmp/fluxion.config.ts', '127.0.0.1', 3010, 3011);
    await vi.runAllTimersAsync();
    await registerPromise;

    expect(processKillSpy).toHaveBeenCalledWith(duplicatePid, 'SIGTERM');
    expect(processKillSpy).toHaveBeenCalledWith(duplicatePid, 'SIGKILL');

    const stored = JSON.parse(fs.readFileSync(instanceFilePath, 'utf-8')) as {
      instances: Array<{ pid: number; port: number; metaPort: number; configPath: string }>;
    };

    expect(stored.instances).toEqual([
      expect.objectContaining({
        pid: currentPid,
        port: 3010,
        metaPort: 3011,
        configPath: '/tmp/fluxion.config.ts',
      }),
    ]);
  });

  it('removes the current process record on unregister without deleting other live instances', async () => {
    const currentPid = process.pid;
    const otherPid = 5252;
    const instanceFilePath = path.join(tempHome, '.fluxion', 'instances.json');

    fs.mkdirSync(path.dirname(instanceFilePath), { recursive: true });
    fs.writeFileSync(
      instanceFilePath,
      JSON.stringify({
        instances: [
          {
            startTime: Date.now() - 2000,
            pid: currentPid,
            host: '127.0.0.1',
            port: 4000,
            metaPort: 4001,
            cwd: '/tmp/current',
            configPath: '/tmp/current.config.ts',
          },
          {
            startTime: Date.now() - 1000,
            pid: otherPid,
            host: '127.0.0.1',
            port: 5000,
            metaPort: 5001,
            cwd: '/tmp/other',
            configPath: '/tmp/other.config.ts',
          },
        ],
      }),
    );

    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (signal === 0 && (pid === currentPid || pid === otherPid)) {
        return true;
      }

      return true;
    }) as typeof process.kill);

    const { FluxionInstanceManager } = await import('../src/cluster/launcher.js');
    const manager = new FluxionInstanceManager();

    manager.unregister();

    const stored = JSON.parse(fs.readFileSync(instanceFilePath, 'utf-8')) as {
      instances: Array<{ pid: number; port: number; configPath: string }>;
    };

    expect(stored.instances).toEqual([
      expect.objectContaining({
        pid: otherPid,
        port: 5000,
        configPath: '/tmp/other.config.ts',
      }),
    ]);
  });
});
