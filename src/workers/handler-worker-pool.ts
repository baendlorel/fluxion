import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { getErrorMessage, logJsonl } from '@/common/logger.js';

import type { protocol } from './protocol.js';
import type { ExecutorOptions } from './options.js';
import { resolveExecutorOptions } from './options.js';

class WorkerRuntimeError extends Error {
  public readonly code?: string;

  constructor(error: protocol.SerializedError) {
    super(error.message);
    this.name = error.name;
    this.code = error.code;
    this.stack = error.stack ?? this.stack;
  }
}

interface InflightRequest {
  resolve: (response: protocol.SerializedResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function resolveWorkerEntryUrl(): URL {
  const currentExt = path.extname(fileURLToPath(import.meta.url));
  const workerFileName = currentExt === '.ts' ? 'handler-worker.ts' : 'handler-worker.js';
  return new URL(`./${workerFileName}`, import.meta.url);
}

export interface HandlerWorkerPool {
  execute(payload: protocol.Payload): Promise<protocol.SerializedResponse>;
  clearCache(): Promise<void>;
  close(): Promise<void>;
}

export function createHandlerWorkerPool(overrides?: Partial<ExecutorOptions>): HandlerWorkerPool {
  return new HandlerWorkerPoolImpl(resolveExecutorOptions(overrides));
}

class HandlerWorkerPoolImpl implements HandlerWorkerPool {
  private readonly options: ExecutorOptions;

  private readonly workerUrl: URL;

  private readonly inflight = new Map<string, InflightRequest>();

  private readonly versionsByFilePath = new Map<string, string>();

  private requestCounter = 0;

  private worker: Worker | undefined;

  private restarting: Promise<void> | undefined;

  private closed = false;

  constructor(options: ExecutorOptions) {
    this.options = options;
    this.workerUrl = resolveWorkerEntryUrl();
  }

  async execute(payload: protocol.Payload): Promise<protocol.SerializedResponse> {
    return this.executeWithRetry(payload, false);
  }

  async clearCache(): Promise<void> {
    this.versionsByFilePath.clear();
    await this.restart('cache_cleared');
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.rejectInflight(new Error('runtime worker closed'));

    const worker = this.worker;
    this.worker = undefined;

    if (worker === undefined) {
      return;
    }

    try {
      await worker.terminate();
    } catch (error) {
      logJsonl('WARN', 'runtime_worker_terminate_failed', {
        error: getErrorMessage(error),
      });
    }
  }

  private async executeWithRetry(payload: protocol.Payload, retried: boolean): Promise<protocol.SerializedResponse> {
    try {
      return await this.executeOnce(payload);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (!retried && code === 'WORKER_VERSION_MISMATCH') {
        await this.restart('worker_version_mismatch');
        this.versionsByFilePath.set(payload.filePath, payload.version);
        return this.executeWithRetry(payload, true);
      }

      throw error;
    }
  }

  private async executeOnce(payload: protocol.Payload): Promise<protocol.SerializedResponse> {
    if (this.closed) {
      throw new Error('runtime worker is closed');
    }

    if (this.inflight.size >= this.options.maxInflight) {
      const overloadError = new Error('runtime worker overloaded');
      (overloadError as NodeJS.ErrnoException).code = 'WORKER_OVERLOADED';
      throw overloadError;
    }

    const knownVersion = this.versionsByFilePath.get(payload.filePath);
    if (knownVersion !== undefined && knownVersion !== payload.version) {
      await this.restart('handler_version_changed');
    }

    this.versionsByFilePath.set(payload.filePath, payload.version);

    const worker = this.ensureWorker();

    return new Promise<protocol.SerializedResponse>((resolve, reject) => {
      const id = `${Date.now().toString(36)}-${(this.requestCounter++).toString(36)}`;

      const timer = setTimeout(() => {
        this.inflight.delete(id);

        const timeoutError = new Error(`runtime worker timeout after ${this.options.requestTimeoutMs}ms`);
        (timeoutError as NodeJS.ErrnoException).code = 'WORKER_TIMEOUT';

        reject(timeoutError);
        void this.restart('request_timeout');
      }, this.options.requestTimeoutMs);

      this.inflight.set(id, { resolve, reject, timer });

      const message: protocol.InboundMessage = {
        type: 'execute',
        id,
        payload,
      };

      worker.postMessage(message);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker !== undefined) {
      return this.worker;
    }

    const worker = new Worker(this.workerUrl, {
      workerData: {
        memorySampleIntervalMs: this.options.memorySampleIntervalMs,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: this.options.maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: this.options.maxYoungGenerationSizeMb,
        stackSizeMb: this.options.stackSizeMb,
      },
    });

    worker.unref();

    worker.on('message', (message: protocol.OutboundMessage) => {
      this.handleWorkerMessage(message);
    });

    worker.once('error', (error) => {
      logJsonl('ERROR', 'runtime_worker_error', {
        error: getErrorMessage(error),
      });

      this.rejectInflight(new Error(`runtime worker error: ${getErrorMessage(error)}`));
      this.worker = undefined;

      if (!this.closed) {
        void this.restart('worker_error');
      }
    });

    worker.once('exit', (code) => {
      const currentWorker = this.worker;
      if (currentWorker !== worker) {
        return;
      }

      this.worker = undefined;

      if (this.closed) {
        return;
      }

      const exitError = new Error(`runtime worker exited with code ${code}`);
      this.rejectInflight(exitError);
      void this.restart('worker_exit');
    });

    this.worker = worker;
    logJsonl('INFO', 'runtime_worker_started', {
      maxOldGenerationSizeMb: this.options.maxOldGenerationSizeMb,
      maxYoungGenerationSizeMb: this.options.maxYoungGenerationSizeMb,
      stackSizeMb: this.options.stackSizeMb,
    });
    return worker;
  }

  private handleWorkerMessage(message: protocol.OutboundMessage): void {
    if (message.type === 'memory') {
      this.handleMemoryMessage(message);
      return;
    }

    const inflight = this.inflight.get(message.id);
    if (inflight === undefined) {
      return;
    }

    this.inflight.delete(message.id);
    clearTimeout(inflight.timer);

    if (!message.ok) {
      inflight.reject(new WorkerRuntimeError(message.error ?? { name: 'Error', message: 'Unknown worker error' }));
      return;
    }

    if (message.response === undefined) {
      inflight.reject(new Error('runtime worker missing response payload'));
      return;
    }

    inflight.resolve(message.response);
  }

  private handleMemoryMessage(message: protocol.MemoryMessage): void {
    const softLimitBytes = this.options.memorySoftLimitMb * 1024 * 1024;
    const hardLimitBytes = this.options.memoryHardLimitMb * 1024 * 1024;

    if (message.heapUsed >= hardLimitBytes) {
      logJsonl('WARN', 'runtime_worker_memory_hard_limit', {
        heapUsed: message.heapUsed,
        hardLimitBytes,
      });
      void this.restart('memory_hard_limit');
      return;
    }

    if (message.heapUsed >= softLimitBytes && this.inflight.size === 0) {
      logJsonl('WARN', 'runtime_worker_memory_soft_limit', {
        heapUsed: message.heapUsed,
        softLimitBytes,
      });
      void this.restart('memory_soft_limit');
    }
  }

  private async restart(reason: string): Promise<void> {
    if (this.closed) {
      return;
    }

    if (this.restarting !== undefined) {
      await this.restarting;
      return;
    }

    this.restarting = this.performRestart(reason).finally(() => {
      this.restarting = undefined;
    });

    await this.restarting;
  }

  private async performRestart(reason: string): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    this.versionsByFilePath.clear();

    this.rejectInflight(new Error(`runtime worker restarted: ${reason}`));

    if (worker !== undefined) {
      try {
        await worker.terminate();
      } catch (error) {
        logJsonl('WARN', 'runtime_worker_restart_terminate_failed', {
          reason,
          error: getErrorMessage(error),
        });
      }
    }

    if (this.closed) {
      return;
    }

    this.ensureWorker();
    logJsonl('WARN', 'runtime_worker_restarted', { reason });
  }

  private rejectInflight(error: Error): void {
    const requests = Array.from(this.inflight.values());
    this.inflight.clear();

    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      clearTimeout(request.timer);
      request.reject(error);
    }
  }
}
