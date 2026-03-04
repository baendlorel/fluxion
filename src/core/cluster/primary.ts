import os from 'node:os';
import cluster from 'node:cluster';

import type { WorkerMessage, WorkerState } from './types.js';
import { fluxionOptions, logger } from './global-state.js';
import { isWorkerMessage, WorkerAction, PrimaryAction } from './consts.js';
import { sendToWorker } from './communicate.js';
import { createPrimaryMetaApiServer } from './meta-api.js';

const bytesToMb = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(2));

export function initPrimary() {
  if (!cluster.isPrimary) {
    $throw('createPrimary should only be called in primary process');
  }

  const { workerOptions } = fluxionOptions;
  const cpuCount = Math.max(1, os.cpus().length);
  const workerCount = Math.max(1, Math.min(workerOptions.maxWorkerCount ?? Math.min(2, cpuCount), cpuCount));

  logger.info('PrimaryStarted', {
    pid: process.pid,
    workers: workerCount,
    host: fluxionOptions.host,
    port: fluxionOptions.port,
    metaPort: fluxionOptions.metaPort,
  });

  const workers = new Map<number, WorkerState>();

  const getWorkersSnapshot = () => {
    return {
      primaryPid: process.pid,
      host: fluxionOptions.host,
      port: fluxionOptions.port,
      metaPort: fluxionOptions.metaPort,
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      workers: Array.from(workers.entries()).map(([workerId, info]) => {
        const { instance } = info;
        const stats = info.lastStats;
        return {
          workerId,
          pid: info.pid ?? instance.process.pid ?? null,
          state: info.state,
          createdAt: info.createdAt,
          readyAt: info.readyAt ?? null,
          connected: instance.isConnected(),
          dead: instance.isDead(),
          exitedAfterDisconnect: instance.exitedAfterDisconnect,
          lastPongAt: info.lastPongAt ?? null,
          lastRttMs: info.lastRttMs ?? null,
          stats:
            stats === undefined
              ? null
              : {
                  at: stats.at,
                  uptimeSeconds: stats.uptimeSeconds,
                  cpu: stats.cpu,
                  memory: {
                    ...stats.memory,
                    rssMb: bytesToMb(stats.memory.rss),
                    heapTotalMb: bytesToMb(stats.memory.heapTotal),
                    heapUsedMb: bytesToMb(stats.memory.heapUsed),
                    externalMb: bytesToMb(stats.memory.external),
                    arrayBuffersMb: bytesToMb(stats.memory.arrayBuffers),
                  },
                },
        };
      }),
    };
  };

  createPrimaryMetaApiServer({
    host: fluxionOptions.host,
    port: fluxionOptions.metaPort,
    logger,
    getWorkersSnapshot,
  });

  const attachWorker = (worker: cluster.Worker): void => {
    const workerInfo: WorkerState = {
      state: 'creating',
      pid: worker.process.pid,
      createdAt: Date.now(),
      instance: worker,
    };
    workers.set(worker.id, workerInfo);

    worker.on('message', (raw: WorkerMessage) => {
      if (!isWorkerMessage(raw)) {
        return;
      }

      if (raw.type === WorkerAction.Pong) {
        const rtt = Date.now() - raw.sentAt;
        workerInfo.pid = raw.pid;
        workerInfo.lastPongAt = Date.now();
        workerInfo.lastRttMs = rtt;
        return;
      }

      if (raw.type === WorkerAction.Ready) {
        workerInfo.state = 'ready';
        workerInfo.pid = raw.pid;
        workerInfo.readyAt = Date.now();
        logger.info('WorkerReady', { workerId: worker.id, pid: raw.pid });
        return;
      }

      if (raw.type === WorkerAction.Created) {
        workerInfo.state = 'created';
        workerInfo.pid = raw.pid;
        logger.info('WorkerCreated', { workerId: worker.id, pid: raw.pid });
        return;
      }

      if (raw.type === WorkerAction.Stats) {
        workerInfo.pid = raw.pid;
        workerInfo.lastStats = raw.stats;
      }
    });

    worker.on('exit', (code, signal) => {
      workers.delete(worker.id);
      logger.warn('WorkerExited', {
        workerId: worker.id,
        pid: worker.process.pid ?? 'unknown',
        code,
        signal: signal ?? 'none',
      });
    });
  };

  for (let i = 0; i < workerCount; i++) {
    attachWorker(cluster.fork({ WORKER_ID: String(i + 1) }));
  }

  const pingTimer = setInterval(() => {
    const sentAt = Date.now();
    for (const info of workers.values()) {
      if (!info.instance.isConnected()) {
        continue;
      }
      try {
        sendToWorker(info.instance, { type: PrimaryAction.Ping, sentAt });
      } catch {
        // Ignore transient IPC errors; worker lifecycle events will reconcile state.
      }
    }
  }, 5000);
  pingTimer.unref();
}
