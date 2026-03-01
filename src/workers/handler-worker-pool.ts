import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { getErrorMessage, logJsonl } from '@/common/logger.js';

import type { protocol } from './protocol.js';
import type { ExecutorOptions } from './options.js';
import { resolveExecutorOptions } from './options.js';

/**
 * Re-hydrated error from worker side.
 */
class WorkerRuntimeError extends Error {
  /**
   * Worker-provided error code.
   */
  public readonly code?: string;

  /**
   * @param error Serialized worker error payload.
   */
  constructor(error: protocol.SerializedError) {
    super(error.message);
    this.name = error.name;
    this.code = error.code;
    this.stack = error.stack ?? this.stack;
  }
}

/**
 * Pending request state.
 */
interface InflightRequest {
  /**
   * Resolve pending execution with response payload.
   */
  resolve: (response: protocol.SerializedResponse) => void;
  /**
   * Reject pending execution with runtime/transport error.
   */
  reject: (error: Error) => void;
  /**
   * Timeout handle for request deadline.
   */
  timer: NodeJS.Timeout;
}

/**
 * Snapshot used by meta api to expose worker runtime state.
 */
export interface HandlerWorkerSnapshot {
  /**
   * Worker lifecycle status.
   */
  status: 'running' | 'stopped' | 'restarting' | 'closed';
  /**
   * Current worker thread id.
   */
  threadId?: number;
  /**
   * Number of in-flight requests.
   */
  inflight: number;
  /**
   * Number of tracked handler versions.
   */
  trackedHandlers: number;
  /**
   * Main-thread handler version table.
   */
  handlers: Array<{ filePath: string; version: string }>;
  /**
   * Total supervisor restart count.
   */
  restartCount: number;
  /**
   * Last restart reason.
   */
  lastRestartReason?: string;
  /**
   * Epoch timestamp of last restart.
   */
  lastRestartAt?: number;
  /**
   * Active runtime limits.
   */
  limits: {
    /**
     * Request timeout in milliseconds.
     */
    requestTimeoutMs: number;
    /**
     * Max parallel requests.
     */
    maxInflight: number;
    /**
     * Soft heap cap in MB.
     */
    memorySoftLimitMb: number;
    /**
     * ! Hard heap cap in MB.
     */
    memoryHardLimitMb: number;
    /**
     * ! V8 old-space cap in MB.
     */
    maxOldGenerationSizeMb: number;
    /**
     * ! V8 young-space cap in MB.
     */
    maxYoungGenerationSizeMb: number;
    /**
     * V8 stack cap in MB.
     */
    stackSizeMb: number;
  };
  /**
   * Latest sampled memory data.
   */
  memory?: {
    /**
     * Heap used bytes.
     */
    heapUsed: number;
    /**
     * RSS bytes.
     */
    rss: number;
    /**
     * External memory bytes.
     */
    external: number;
    /**
     * ArrayBuffer bytes.
     */
    arrayBuffers: number;
    /**
     * Epoch timestamp when sample was received.
     */
    sampledAt: number;
  };
}

/**
 * Resolves worker entry for tsx dev and compiled js runtime.
 */
function resolveWorkerEntryUrl(): URL {
  const currentExt = path.extname(fileURLToPath(import.meta.url));
  const workerFileName = currentExt === '.ts' ? 'handler-worker.ts' : 'handler-worker.js';
  return new URL(`./${workerFileName}`, import.meta.url);
}

/**
 * Main-thread API for worker-backed handler execution.
 */
export interface HandlerWorkerPool {
  /**
   * Executes a handler request in worker.
   */
  execute(payload: protocol.Payload): Promise<protocol.SerializedResponse>;
  /**
   * Clears tracked state and rotates worker.
   */
  clearCache(): Promise<void>;
  /**
   * Closes worker and rejects pending requests.
   */
  close(): Promise<void>;
  /**
   * Returns a runtime snapshot for diagnostics.
   */
  getSnapshot(): HandlerWorkerSnapshot;
}

/**
 * Creates a worker pool using merged runtime defaults.
 */
export function createHandlerWorkerPool(overrides?: Partial<ExecutorOptions>): HandlerWorkerPool {
  return new HandlerWorkerPoolImpl(resolveExecutorOptions(overrides));
}

class HandlerWorkerPoolImpl implements HandlerWorkerPool {
  /**
   * Resolved runtime options.
   */
  private readonly options: ExecutorOptions;

  /**
   * Worker entry module url.
   */
  private readonly workerUrl: URL;

  /**
   * Pending request registry.
   */
  private readonly inflight = new Map<string, InflightRequest>();

  /**
   * File path -> version cache mirrored in main thread.
   */
  private readonly versionsByFilePath = new Map<string, string>();

  /**
   * Monotonic request id counter.
   */
  private requestCounter = 0;

  /**
   * Current worker instance.
   */
  private worker: Worker | undefined;

  /**
   * Restart mutex promise.
   */
  private restarting: Promise<void> | undefined;

  /**
   * Indicates the pool has been closed.
   */
  private closed = false;

  /**
   * Latest memory message from worker.
   */
  private latestMemory: protocol.MemoryMessage | undefined;

  /**
   * Timestamp of latest memory message.
   */
  private latestMemoryAt: number | undefined;

  /**
   * Total restart times.
   */
  private restartCount = 0;

  /**
   * Last restart reason text.
   */
  private lastRestartReason: string | undefined;

  /**
   * Timestamp of last restart.
   */
  private lastRestartAt: number | undefined;

  /**
   * @param options Resolved runtime options.
   */
  constructor(options: ExecutorOptions) {
    this.options = options;
    this.workerUrl = resolveWorkerEntryUrl();
  }

  /**
   * Executes request and retries once when version mismatch is detected.
   */
  async execute(payload: protocol.Payload): Promise<protocol.SerializedResponse> {
    return this.executeWithRetry(payload, false);
  }

  /**
   * Clears version cache and restarts the worker.
   */
  async clearCache(): Promise<void> {
    this.versionsByFilePath.clear();
    await this.restart('cache_cleared');
  }

  /**
   * Stops worker and rejects all in-flight requests.
   */
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

  /**
   * Builds current pool diagnostics snapshot.
   */
  getSnapshot(): HandlerWorkerSnapshot {
    const handlers = Array.from(this.versionsByFilePath.entries())
      .map(([filePath, version]) => ({ filePath, version }))
      .sort((left, right) => left.filePath.localeCompare(right.filePath));

    return {
      status: this.getStatus(),
      threadId: this.worker?.threadId,
      inflight: this.inflight.size,
      trackedHandlers: handlers.length,
      handlers,
      restartCount: this.restartCount,
      lastRestartReason: this.lastRestartReason,
      lastRestartAt: this.lastRestartAt,
      limits: {
        requestTimeoutMs: this.options.requestTimeoutMs,
        maxInflight: this.options.maxInflight,
        memorySoftLimitMb: this.options.memorySoftLimitMb,
        memoryHardLimitMb: this.options.memoryHardLimitMb,
        maxOldGenerationSizeMb: this.options.maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: this.options.maxYoungGenerationSizeMb,
        stackSizeMb: this.options.stackSizeMb,
      },
      memory:
        this.latestMemory === undefined || this.latestMemoryAt === undefined
          ? undefined
          : {
              heapUsed: this.latestMemory.heapUsed,
              rss: this.latestMemory.rss,
              external: this.latestMemory.external,
              arrayBuffers: this.latestMemory.arrayBuffers,
              sampledAt: this.latestMemoryAt,
            },
    };
  }

  /**
   * Executes request with one retry path for stale worker cache.
   */
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

  /**
   * Enqueues a request into worker with timeout protection.
   */
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

  /**
   * Starts worker on demand and wires supervisor hooks.
   */
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

  /**
   * Dispatches worker messages to result handlers.
   */
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

  /**
   * Updates memory sample and enforces soft/hard thresholds.
   */
  private handleMemoryMessage(message: protocol.MemoryMessage): void {
    this.latestMemory = message;
    this.latestMemoryAt = Date.now();

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

  /**
   * Serializes restart operations to avoid duplicate restarts.
   */
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

  /**
   * Replaces current worker instance with a fresh one.
   */
  private async performRestart(reason: string): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    this.versionsByFilePath.clear();
    this.restartCount += 1;
    this.lastRestartReason = reason;
    this.lastRestartAt = Date.now();

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

  /**
   * Rejects all currently pending requests.
   */
  private rejectInflight(error: Error): void {
    const requests = Array.from(this.inflight.values());
    this.inflight.clear();

    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      clearTimeout(request.timer);
      request.reject(error);
    }
  }

  /**
   * Computes pool status for snapshots.
   */
  private getStatus(): HandlerWorkerSnapshot['status'] {
    if (this.closed) {
      return 'closed';
    }

    if (this.restarting !== undefined) {
      return 'restarting';
    }

    if (this.worker === undefined) {
      return 'stopped';
    }

    return 'running';
  }
}
