import os from 'node:os';
import cluster from 'node:cluster';
import type { NormalizedFluxionOptions } from '../types.js';
import type { WorkerMessage, WorkerState } from './types.js';

import { initializeGlobalState } from './global-state.js';
import { isWorkerMessage, WorkerAction, PrimaryAction } from './consts.js';
import { sendToWorker } from './communicate.js';

export function createPrimary(options: NormalizedFluxionOptions) {
  if (!cluster.isPrimary) {
    $throw('createPrimary should only be called in primary process');
  }
  initializeGlobalState(options);

  const { workerOptions, logger } = options;
  const cpuCount = Math.max(1, os.cpus().length);
  const workerCount = Math.max(1, Math.min(workerOptions.maxWorkerCount ?? Math.min(2, cpuCount), cpuCount));

  logger.info(`[primary ${process.pid}] start cluster, workers=${workerCount}`);

  const workers = new Map<number, WorkerState>();

  const attachWorker = (worker: cluster.Worker): void => {
    const workerInfo: WorkerState = { state: 'creating', instance: worker };
    workers.set(worker.id, workerInfo);

    worker.on('message', (raw: WorkerMessage) => {
      if (!isWorkerMessage(raw)) {
        return;
      }

      if (raw.type === WorkerAction.Pong) {
        const rtt = Date.now() - raw.sentAt;
        logger.info(`[primary ${process.pid}] pong from worker ${raw.pid}, rtt=${rtt}ms, workerTime=${raw.receivedAt}`);
        return;
      }

      if (raw.type === WorkerAction.Ready) {
        // & only when worker is ready, we can send task to it
        workerInfo.state = 'ready';
        logger.info(`[primary ${process.pid}] worker ${raw.pid} is ready`);
        return;
      }

      if (raw.type === WorkerAction.Created) {
        workerInfo.state = 'created';
        sendToWorker(worker, { type: PrimaryAction.SendFluxionOptions, options });
        return;
      }

      logger.info(`[primary ${process.pid}] unknown message=${raw}`);
    });

    worker.on('exit', (code, signal) => {
      workers.delete(worker.id);
      logger.info(
        `[primary ${process.pid}] worker ${worker.process.pid ?? 'unknown'} exited, code=${code}, signal=${signal ?? 'none'}`,
      );
    });
  };

  for (let i = 0; i < workerCount; i++) {
    attachWorker(cluster.fork());
  }
}
