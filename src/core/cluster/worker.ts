import os from 'node:os';
import cluster from 'node:cluster';

import type { ResolvedFluxionOptions } from '../types.js';
import type { RunTaskMessage, ToPrimaryMessage, ToWorkerMessage, WorkerState } from './types.js';
import { ToPrimaryType, ToWorkerType, isToPrimary, isToWorker } from './consts.js';
import { createFileRuntime } from './file-runtime.js';

const sendToPrimary = (message: ToPrimaryMessage) => process.send?.(message);

export async function createWorker() {
  if (cluster.isPrimary) {
    $throw('createWorker should only be called in worker process');
  }

  // todo 第一步是要接收fluxionoptions
  const rawInjections = fluxionOptions.injections.map(async (v) => ({ name: v.name, instance: await v.factory() }));
  const injections = await Promise.all(rawInjections);
  injections.forEach((v) => Reflect.set(globalThis, v.name, v.instance));

  // todo 在这里启动url2handler的监听，收到消息后直接执行对应的handler

  createFileRuntime();

  sendToPrimary({
    type: ToPrimaryType.Ready,
    pid: process.pid,
  });

  process.on('message', (raw: ToWorkerMessage) => {
    if (!isToWorker(raw)) {
      return;
    }

    console.log(`[worker ${process.pid}] received message`, raw);
    if (raw.type === ToWorkerType.Ping) {
      sendToPrimary({
        type: ToPrimaryType.Pong,
        pid: process.pid,
        sentAt: raw.sentAt,
        receivedAt: Date.now(),
      });
      return;
    }
  });
}

export function createWorkerManager(options: ResolvedFluxionOptions) {
  const { workerOptions, logger } = options;
  const cpuCount = Math.max(1, os.cpus().length);
  const workerCount = Math.max(1, Math.min(workerOptions.maxWorkerCount ?? Math.min(2, cpuCount), cpuCount));

  logger.info(`[primary ${process.pid}] start cluster, workers=${workerCount}`);

  const workers = new Map<number, WorkerState>();

  const attachWorker = (worker: cluster.Worker): void => {
    const workerInfo: WorkerState = { state: 'creating', instance: worker };
    workers.set(worker.id, workerInfo);

    worker.on('message', (rawMessage: ToPrimaryMessage) => {
      if (!isToPrimary(rawMessage)) {
        return;
      }

      if (rawMessage.type === ToPrimaryType.Created) {
        workerInfo.state = 'created';
        worker.send({ type: ToWorkerType.Options, fluxionOptions });
        return;
      }

      if (rawMessage.type === ToPrimaryType.Pong) {
        const rtt = Date.now() - rawMessage.sentAt;
        logger.info(
          `[primary ${process.pid}] pong from worker ${rawMessage.pid}, rtt=${rtt}ms, workerTime=${rawMessage.receivedAt}`,
        );
        return;
      }

      if (rawMessage.type === ToPrimaryType.Ready) {
        // & only when worker is ready, we can send task to it
        workerInfo.state = 'ready';
        logger.info(`[primary ${process.pid}] worker ${rawMessage.pid} is ready`);
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
