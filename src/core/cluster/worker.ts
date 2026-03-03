import os from 'node:os';
import cluster from 'node:cluster';

import type { ResolvedFluxionOptions } from '../types.js';
import type { RunTaskMessage, ToPrimaryMessage, ToWorkerMessage, WorkerState } from './types.js';
import { ToPrimaryType, ToWorkerType, isToPrimary, isToWorker } from './consts.js';

const sendToPrimary = (message: ToPrimaryMessage) => process.send?.(message);

export async function createWorker(options: ResolvedFluxionOptions) {
  if (cluster.isPrimary) {
    throw new Error('createWorker should only be called in worker process');
  }

  const rawInjections = options.injections.map(async (v) => ({ name: v.name, instance: await v.factory() }));
  const injections = await Promise.all(rawInjections);
  injections.forEach((v) => Reflect.set(globalThis, v.name, v.instance));

  sendToPrimary({
    type: ToPrimaryType.Ready,
    pid: process.pid,
  });

  process.on('message', (rawMessage: ToWorkerMessage) => {
    if (!isToWorker(rawMessage)) {
      return;
    }

    console.log(`[worker ${process.pid}] received message`, rawMessage);
    if (rawMessage.type === ToWorkerType.Ping) {
      sendToPrimary({
        type: ToPrimaryType.Pong,
        pid: process.pid,
        sentAt: rawMessage.sentAt,
        receivedAt: Date.now(),
      });
      return;
    }

    // todo 这里就解析url内容，找到文件来执行吧！
    const someTask = (x: any) => x;
    const result = someTask(rawMessage.payload);
    sendToPrimary({
      type: ToPrimaryType.TaskResult,
      taskId: rawMessage.taskId,
      pid: process.pid,
      result,
    });
  });
}

export function createWorkerManager(options: ResolvedFluxionOptions) {
  const { workerOptions, logger } = options;
  const cpuCount = Math.max(1, os.cpus().length);
  const workerCount = Math.max(1, Math.min(workerOptions.maxWorkerCount ?? Math.min(2, cpuCount), cpuCount));

  logger.info(`[primary ${process.pid}] start cluster, workers=${workerCount}`);

  const workers = new Map<number, WorkerState>();

  const attachWorker = (worker: cluster.Worker): void => {
    const workerInfo: WorkerState = { isReady: false, instance: worker };
    workers.set(worker.id, workerInfo);

    worker.on('message', (rawMessage: ToPrimaryMessage) => {
      if (!isToPrimary(rawMessage)) {
        return;
      }

      if (rawMessage.type === ToPrimaryType.Ready) {
        workerInfo.isReady = true; // & only when worker is ready, we can send task to it
        return;
      }

      if (rawMessage.type === ToPrimaryType.Pong) {
        const rtt = Date.now() - rawMessage.sentAt;
        logger.info(
          `[primary ${process.pid}] pong from worker ${rawMessage.pid}, rtt=${rtt}ms, workerTime=${rawMessage.receivedAt}`,
        );
        return;
      }

      logger.info(
        `[primary ${process.pid}] task result from worker ${rawMessage.pid}, task=${rawMessage.taskId}, result=${rawMessage.result}`,
      );
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
