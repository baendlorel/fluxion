import os from 'node:os';
import cluster from 'node:cluster';
import { ResolvedFluxionOptions } from '../types.js';
import { WorkerMessage, WorkerState } from './types.js';
import { isWorkerMessage, WorkerAction, PrimaryAction } from './consts.js';

export function createPrimary(options: ResolvedFluxionOptions) {
  if (!cluster.isPrimary) {
    $throw('createPrimary should only be called in primary process');
  }

  const { workerOptions, logger } = options;
  const cpuCount = Math.max(1, os.cpus().length);
  const workerCount = Math.max(1, Math.min(workerOptions.maxWorkerCount ?? Math.min(2, cpuCount), cpuCount));

  logger.info(`[primary ${process.pid}] start cluster, workers=${workerCount}`);

  const workers = new Map<number, WorkerState>();

  const attachWorker = (worker: cluster.Worker): void => {
    const workerInfo: WorkerState = { state: 'creating', instance: worker };
    workers.set(worker.id, workerInfo);

    worker.on('message', (rawMessage: WorkerMessage) => {
      if (!isWorkerMessage(rawMessage)) {
        return;
      }

      if (rawMessage.type === WorkerAction.Pong) {
        const rtt = Date.now() - rawMessage.sentAt;
        logger.info(
          `[primary ${process.pid}] pong from worker ${rawMessage.pid}, rtt=${rtt}ms, workerTime=${rawMessage.receivedAt}`,
        );
        return;
      }

      if (rawMessage.type === WorkerAction.Ready) {
        // & only when worker is ready, we can send task to it
        workerInfo.state = 'ready';
        logger.info(`[primary ${process.pid}] worker ${rawMessage.pid} is ready`);
        return;
      }

      if (rawMessage.type === WorkerAction.Created) {
        workerInfo.state = 'created';
        worker.send({ type: PrimaryAction.SendFluxionOptions, fluxionOptions });
        return;
      }

      logger.info(`[primary ${process.pid}] unknown message=${rawMessage}`);
    });

    worker.on('exit', (code, signal) => {
      workers.delete(worker.id);
      logger.info(
        `[primary ${process.pid}] worker ${worker.process.pid ?? 'unknown'} exited, code=${code}, signal=${signal ?? 'none'}`,
      );
    });
  };

  // cluster.setupPrimary({
  //   exec: process.argv[1],
  //   args: process.argv.slice(2),
  //   env: process.env,
  //   silent: false,
  // });
  for (let i = 0; i < workerCount; i++) {
    attachWorker(cluster.fork());
  }
}
