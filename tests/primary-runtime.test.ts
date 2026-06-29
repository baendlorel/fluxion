import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FluxionContext } from '../src/types.js';

const launchFluxionInstanceMock = vi.fn();
const cleanupFluxionInstanceMock = vi.fn();
const sendToWorkerMock = vi.fn();
const createPrimaryMetaApiServerMock = vi.fn();

vi.mock('../src/cluster/launcher.js', () => ({
  launchFluxionInstance: launchFluxionInstanceMock,
  cleanupFluxionInstance: cleanupFluxionInstanceMock,
}));

vi.mock('../src/cluster/communicate.js', () => ({
  sendToWorker: sendToWorkerMock,
}));

vi.mock('../src/cluster/meta-api.js', () => ({
  createPrimaryMetaApiServer: createPrimaryMetaApiServerMock,
}));

type WorkerHandlerMap = {
  message?: (payload: unknown) => void;
  exit?: (code: number | null, signal: NodeJS.Signals | null) => void;
};

type FakeWorker = {
  id: number;
  process: {
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  kill: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
  isDead: ReturnType<typeof vi.fn>;
  exitedAfterDisconnect: boolean;
  on: ReturnType<typeof vi.fn>;
  handlers: WorkerHandlerMap;
};

const makeContext = (): Pick<FluxionContext, 'logger' | 'options' | 'router'> => {
  return {
    logger: {
      write: vi.fn(),
      succ: vi.fn(),
      verbose: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    options: {
      host: '127.0.0.1',
      port: 3200,
      metaPort: 3201,
      moduleDir: '/tmp/fluxion-primary-test',
      workerOptions: {
        maxWorkerCount: 1,
        restartWhen: {
          memoryUsageGreaterThan: Infinity,
          healthzTimeout: 30_000,
          uptimeGreaterThan: Infinity,
        },
      },
    } as FluxionContext['options'],
    router: {
      getRoutes: vi.fn(() => []),
    } as any,
  } as Pick<FluxionContext, 'logger' | 'options' | 'router'>;
};

describe('FluxionPrimaryController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    launchFluxionInstanceMock.mockReset().mockResolvedValue(undefined);
    cleanupFluxionInstanceMock.mockReset().mockResolvedValue(undefined);
    sendToWorkerMock.mockReset();
    createPrimaryMetaApiServerMock.mockReset().mockReturnValue({ close: vi.fn() });
    globalThis.$throw = (message: string): never => {
      throw new Error('[fluxion error]' + message);
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('forces lingering workers to SIGKILL after shutdown timeout and then exits cleanly', async () => {
    let sigtermHandler: (() => void) | undefined;
    const processOnceSpy = vi.spyOn(process, 'once').mockImplementation(((
      event: string,
      listener: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGTERM') {
        sigtermHandler = listener as () => void;
      }
      return process;
    }) as typeof process.once);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    let dead = false;
    const worker: FakeWorker = {
      id: 1,
      process: {
        pid: 9001,
        kill: vi.fn((signal: NodeJS.Signals) => {
          if (signal === 'SIGKILL') {
            dead = true;
          }
        }),
      },
      kill: vi.fn(),
      isConnected: vi.fn(() => true),
      isDead: vi.fn(() => dead),
      exitedAfterDisconnect: false,
      handlers: {},
      on: vi.fn((event: 'message' | 'exit', handler: (...args: unknown[]) => void) => {
        if (event === 'message') {
          worker.handlers.message = handler as WorkerHandlerMap['message'];
        }
        if (event === 'exit') {
          worker.handlers.exit = handler as WorkerHandlerMap['exit'];
        }
        return worker;
      }),
    };

    vi.doMock('node:cluster', () => ({
      default: {
        isPrimary: true,
        fork: vi.fn(() => worker),
      },
    }));

    const { initPrimary } = await import('../src/cluster/primary.js');
    const cx = makeContext();
    await initPrimary(cx);

    expect(sigtermHandler).toBeTypeOf('function');
    expect(worker.kill).not.toHaveBeenCalled();

    sigtermHandler?.();
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();

    expect(worker.kill).toHaveBeenCalledWith('SIGTERM');
    expect(worker.process.kill).toHaveBeenCalledWith('SIGKILL');
    expect(cleanupFluxionInstanceMock).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(0);

    processOnceSpy.mockRestore();
  });

  it('does not respawn a worker that exits during shutdown', async () => {
    let sigtermHandler: (() => void) | undefined;
    vi.spyOn(process, 'once').mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'SIGTERM') {
        sigtermHandler = listener as () => void;
      }
      return process;
    }) as typeof process.once);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    let dead = false;
    const forkMock = vi.fn();
    const worker: FakeWorker = {
      id: 1,
      process: {
        pid: 9002,
        kill: vi.fn(),
      },
      kill: vi.fn(() => {
        dead = true;
        worker.handlers.exit?.(0, 'SIGTERM');
      }),
      isConnected: vi.fn(() => true),
      isDead: vi.fn(() => dead),
      exitedAfterDisconnect: false,
      handlers: {},
      on: vi.fn((event: 'message' | 'exit', handler: (...args: unknown[]) => void) => {
        if (event === 'message') {
          worker.handlers.message = handler as WorkerHandlerMap['message'];
        }
        if (event === 'exit') {
          worker.handlers.exit = handler as WorkerHandlerMap['exit'];
        }
        return worker;
      }),
    };

    forkMock.mockReturnValue(worker);

    vi.doMock('node:cluster', () => ({
      default: {
        isPrimary: true,
        fork: forkMock,
      },
    }));

    const { initPrimary } = await import('../src/cluster/primary.js');
    const cx = makeContext();
    await initPrimary(cx);

    expect(forkMock).toHaveBeenCalledTimes(1);

    sigtermHandler?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(worker.kill).toHaveBeenCalledWith('SIGTERM');
    expect(forkMock).toHaveBeenCalledTimes(1);
    expect(cleanupFluxionInstanceMock).toHaveBeenCalledTimes(1);
  });
});
