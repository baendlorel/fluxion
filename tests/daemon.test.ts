import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchDaemon } from '../src/daemon.js';

globalThis._throw = (message: string): never => {
  throw new Error('[fluxion error]' + message);
};

type Daemon = ReturnType<typeof launchDaemon>;
type DaemonOptionsInput = Parameters<typeof launchDaemon>[0];

// Captured before vi.useFakeTimers(): used to poll real-world state
// (child process events, fs completion) while the daemon's own timers are frozen.
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realDateNow = Date.now.bind(Date);

const sleepReal = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));

const waitFor = async (what: string, predicate: () => boolean, timeoutMs = 5000) => {
  const deadline = realDateNow() + timeoutMs;
  while (realDateNow() < deadline) {
    if (predicate()) {
      return;
    }
    await sleepReal(10);
  }
  throw new Error(`Timed out waiting for ${what}`);
};

// Drive the daemon's fake clock forward until `predicate` holds.
// run() interleaves fake timers (wait/next) with real async I/O (fs open, child exit
// events), so new fake timers keep appearing as pending continuations resume.
// Each step advances 500ms of fake time and then yields to the real event loop,
// so continuations blocked on real I/O can resume and schedule their next timer.
// 500ms steps always stop right after a respawn: the next run is >= checkInterval
// away, so this cannot overshoot into an extra check cycle.
const advanceUntil = async (what: string, predicate: () => boolean, timeoutMs = 5000) => {
  const deadline = realDateNow() + timeoutMs;
  while (!predicate()) {
    if (realDateNow() > deadline) {
      throw new Error(`Timed out advancing fake clock for ${what}`);
    }
    await vi.advanceTimersByTimeAsync(500);
    await sleepReal(10);
  }
};

const alive = (pid?: number) => {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const killHard = (pid?: number) => {
  if (alive(pid)) {
    try {
      process.kill(pid!, 'SIGKILL');
    } catch {
      // already dead
    }
  }
};

const read = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
};

// daemon.ts race fallback: when the old instance's close event arrives after the new
// instance is spawned, its closer handler clobbers this.pid with undefined, so the
// per-daemon pid sweep in afterEach cannot see (and cannot kill) the new child.
// Reap any child still carrying our marker to guarantee a clean slate.
const reapStrayChildren = () => {
  if (process.platform !== 'linux') {
    return;
  }
  try {
    execFileSync('pkill', ['-f', CHILD_MARK], { stdio: 'ignore' });
  } catch {
    // pkill exits with 1 when no process matched — nothing to reap.
  }
};

const tempRoots: string[] = [];
const daemons: Daemon[] = [];

const makeLogsDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxion-daemon-test-'));
  tempRoots.push(dir);
  return dir;
};

// Unique marker so stray children can be reaped by command line, see reapStrayChildren().
const CHILD_MARK = 'fluxion-daemon-test-child';

// Long-lived child: node with the default SIGTERM behavior (dies on SIGTERM).
const HOLD = `/*${CHILD_MARK}*/setInterval(() => {}, 1000);`;
// Child that ignores SIGTERM: only SIGKILL can take it down.
const STUBBORN = `/*${CHILD_MARK}*/process.on("SIGTERM", () => {});` + HOLD;

const nodeInstance = (script: string) => ({
  cmd: process.execPath,
  cmdArgs: ['-e', script],
});

// checkInterval: 2 keeps the fake timeline small:
//   t=0  run #1 spawns, waits 1s, schedules run #2 at t=3s
//   t=3s run #2 checks the instance
const launch = (overrides: Partial<DaemonOptionsInput> = {}) => {
  const daemon = launchDaemon({
    ...nodeInstance(HOLD),
    logsDir: makeLogsDir(),
    checkInterval: 2,
    terminateWait: 1,
    ...overrides,
  });
  daemons.push(daemon);
  return daemon;
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers();
});

afterEach(async () => {
  const started = daemons.splice(0);
  for (const daemon of started) {
    killHard(daemon.pid);
  }
  // A spawn still resolving from the test may set pid after the first pass.
  await sleepReal(100);
  for (const daemon of started) {
    killHard(daemon.pid);
  }
  reapStrayChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('daemon — option validation', () => {
  test('rejects invalid options', () => {
    const base = {
      cmd: process.execPath,
      cmdArgs: [],
      spawnOptions: {},
      logsDir: '/tmp/fluxion-daemon-test-logs', // never written: validation throws first
      port: 9335,
      checkInterval: 30,
      terminateWait: 5,
      isAlive: () => true,
    };

    const cases: Array<[string, any, string]> = [
      ['options is null', null, 'DaemonOptions must be an object'],
      ['options is a number', 42, 'DaemonOptions must be an object'],
      ['options is an array', [], 'DaemonOptions must be an object'],
      ['cmd missing', { ...base, cmd: undefined }, 'cmd must be a non-empty string'],
      ['cmd empty', { ...base, cmd: '' }, 'cmd must be a non-empty string'],
      ['logsDir missing', { ...base, logsDir: undefined }, 'logsDir must be a non-empty string'],
      ['logsDir empty', { ...base, logsDir: '' }, 'logsDir must be a non-empty string'],
      ['port fractional', { ...base, port: 1.5 }, 'port must be a positive integer'],
      ['port as string', { ...base, port: '9335' }, 'port must be a positive integer'],
      ['port below range', { ...base, port: 0 }, 'port must be 1 ~ 65535'],
      ['port above range', { ...base, port: 65536 }, 'port must be 1 ~ 65535'],
      ['cmdArgs not an array', { ...base, cmdArgs: 'x' }, 'cmdArgs must be an array of strings'],
      ['cmdArgs with non-string', { ...base, cmdArgs: ['a', 1] }, 'cmdArgs must be an array of strings'],
      ['spawnOptions null', { ...base, spawnOptions: null }, 'spawnOptions must be an object'],
      ['checkInterval zero', { ...base, checkInterval: 0 }, 'checkInterval must be an integer'],
      ['checkInterval fractional', { ...base, checkInterval: 1.5 }, 'checkInterval must be an integer'],
      ['terminateWait negative', { ...base, terminateWait: -1 }, 'terminateWait must be a non-negative'],
      ['isAlive not a function', { ...base, isAlive: 'x' }, 'isAlive must be a function'],
    ];

    for (const [name, opts, message] of cases) {
      expect(() => launchDaemon(opts), name).toThrow(message);
    }
  });
});

describe('daemon — defaults', () => {
  test('applies default options and announces startup', () => {
    const logsDir = makeLogsDir();
    const daemon = launchDaemon({ cmd: process.execPath, cmdArgs: ['-e', HOLD], logsDir });
    daemons.push(daemon);

    expect(daemon.opts.port).toBe(9335);
    expect(daemon.opts.checkInterval).toBe(30);
    expect(daemon.opts.terminateWait).toBe(5);
    expect(daemon.opts.cmdArgs).toEqual(['-e', HOLD]);
    expect(daemon.opts.spawnOptions).toEqual({});
    expect(daemon.opts.isAlive()).toBe(true);
    expect(daemon.daemonfile).toBe(path.join(logsDir, 'daemon.log'));
    expect(daemon.instancefile).toBe(path.join(logsDir, 'instance.log'));
    expect(console.log).toHaveBeenCalledWith('Fluxion daemon started.');
  });
});

describe('daemon — lifecycle', () => {
  test('spawns the instance and writes logs into logsDir', async () => {
    const daemon = launch();

    await waitFor('first spawn', () => daemon.pid !== undefined);

    expect(alive(daemon.pid)).toBe(true);
    expect(fs.existsSync(daemon.instancefile)).toBe(true);
    await waitFor('daemon.log to record the spawn', () => read(daemon.daemonfile).includes('fluxion spawned'));
  }, 15000);

  test('keeps a healthy instance running', async () => {
    const isAlive = vi.fn(() => true);
    const daemon = launch({ isAlive });
    await waitFor('first spawn', () => daemon.pid !== undefined);
    const pid1 = daemon.pid!;

    // Fires run #2 (scheduled by run #1), which finds the instance healthy.
    await advanceUntil('run #2 to check the instance', () => isAlive.mock.calls.length > 0);

    expect(daemon.pid).toBe(pid1);
    expect(alive(pid1)).toBe(true);
    expect(isAlive).toHaveBeenCalledTimes(1);
  }, 15000);

  test('respawns after the instance dies on its own', async () => {
    const daemon = launch();
    await waitFor('first spawn', () => daemon.pid !== undefined);
    const pid1 = daemon.pid!;

    process.kill(pid1, 'SIGKILL');
    await waitFor('daemon to notice the dead child', () => daemon.pid === undefined);

    // Fires run #2 (scheduled by run #1) which sees no pid and respawns.
    await advanceUntil('respawn', () => daemon.pid !== undefined);

    expect(alive(pid1)).toBe(false);
    expect(alive(daemon.pid)).toBe(true);
    await waitFor(
      'daemon.log to record the respawn',
      () => {
        const log = read(daemon.daemonfile);
        return log.includes('No instance running') && (log.match(/fluxion spawned/g) ?? []).length >= 2;
      },
    );
  }, 15000);

  test('kills and restarts the instance when isAlive reports unhealthy', async () => {
    const isAlive = vi.fn(() => true);
    const daemon = launch({ isAlive });
    await waitFor('first spawn', () => daemon.pid !== undefined);
    const pid1 = daemon.pid!;
    isAlive.mockReturnValue(false);

    // Fires run #2: SIGTERM -> terminateWait -> (SIGKILL if needed) -> respawn.
    await advanceUntil('respawn', () => daemon.pid !== undefined && daemon.pid !== pid1);

    expect(isAlive).toHaveBeenCalledTimes(1);
    expect(alive(pid1)).toBe(false);
    expect(alive(daemon.pid)).toBe(true);
  }, 15000);

  test('escalates to SIGKILL when the instance ignores SIGTERM', async () => {
    const isAlive = vi.fn(() => true);
    const daemon = launch({ ...nodeInstance(STUBBORN), isAlive });
    await waitFor('first spawn', () => daemon.pid !== undefined);
    const pid1 = daemon.pid!;
    isAlive.mockReturnValue(false);

    // Fires run #2: SIGTERM is ignored, so after terminateWait the daemon must SIGKILL.
    await advanceUntil('respawn', () => daemon.pid !== undefined && daemon.pid !== pid1);
    await waitFor('old instance to die', () => !alive(pid1));

    // pid1 ignored SIGTERM, so it can only be dead because of the SIGKILL escalation.
    expect(alive(daemon.pid)).toBe(true);
  }, 15000);

  test('passes FLUXION_PORT to the instance when env is provided', async () => {
    const daemon = launch({
      ...nodeInstance(`console.log('PORT:' + process.env.FLUXION_PORT); ${HOLD}`),
      port: 12345,
      spawnOptions: { env: { ...process.env } },
    });

    await waitFor('first spawn', () => daemon.pid !== undefined);
    await waitFor('instance.log to capture stdout', () => read(daemon.instancefile).includes('PORT:12345'));
  }, 15000);
});
