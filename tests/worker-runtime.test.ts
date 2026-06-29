import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FluxionContext } from '../src/types.js';

const sendToPrimaryMock = vi.fn();
const createWorkerServerMock = vi.fn();

vi.mock('node:cluster', () => ({
  default: {
    isPrimary: false,
  },
}));

vi.mock('../src/cluster/communicate.js', () => ({
  sendToPrimary: sendToPrimaryMock,
}));

vi.mock('../src/cluster/server.js', () => ({
  createWorkerServer: createWorkerServerMock,
}));

const buildContext = (): FluxionContext => {
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
    watcher: {
      stop: vi.fn(),
    } as any,
    router: {
      getRoutes: vi.fn(() => [{ path: '/hello', type: 'api', methods: null }]),
    } as any,
    options: {} as FluxionContext['options'],
  } as FluxionContext;
};

describe('FluxionWorkerRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    sendToPrimaryMock.mockReset();
    createWorkerServerMock.mockReset();
    globalThis.$throw = (message: string): never => {
      throw new Error('[fluxion error]' + message);
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('gracefully shuts down the worker server on SIGTERM', async () => {
    const processOnSpy = vi.spyOn(process, 'on');
    const processOnceSpy = vi.spyOn(process, 'once');
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    let sigtermHandler: (() => void) | undefined;
    processOnceSpy.mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'SIGTERM') {
        sigtermHandler = listener as () => void;
      }
      return process;
    }) as typeof process.once);

    processOnSpy.mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
      return process;
    }) as typeof process.on);

    const closeMock = vi.fn((callback: (error?: Error | null) => void) => callback(null));
    createWorkerServerMock.mockResolvedValue({ close: closeMock });

    const { initWorker } = await import('../src/cluster/worker.js');
    const cx = buildContext();

    initWorker(cx);
    await Promise.resolve();

    expect(sigtermHandler).toBeTypeOf('function');

    sigtermHandler?.();
    await Promise.resolve();

    expect(cx.watcher.stop).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('forces exit with code 1 when graceful shutdown exceeds the timeout', async () => {
    const processOnSpy = vi.spyOn(process, 'on');
    const processOnceSpy = vi.spyOn(process, 'once');
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    let sigtermHandler: (() => void) | undefined;
    processOnceSpy.mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'SIGTERM') {
        sigtermHandler = listener as () => void;
      }
      return process;
    }) as typeof process.once);

    processOnSpy.mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
      return process;
    }) as typeof process.on);

    const closeMock = vi.fn();
    createWorkerServerMock.mockResolvedValue({ close: closeMock });

    const { initWorker } = await import('../src/cluster/worker.js');
    const cx = buildContext();

    initWorker(cx);
    await Promise.resolve();

    sigtermHandler?.();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(cx.watcher.stop).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
