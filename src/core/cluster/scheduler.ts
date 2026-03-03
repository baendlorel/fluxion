import cluster, { type Worker } from 'node:cluster';
import os from 'node:os';
import {
  ToPrimaryMessage,
  ClusterSchedulerDemoOptions,
  RunTaskMessage,
  PingMessage,
  ToWorkerMessage,
} from './types.js';
import { isToWorker, isToPrimary, ToWorkerType, ToPrimaryType } from './consts.js';

const sendToPrimary = (message: ToPrimaryMessage) => process.send?.(message);

function runFakeTask(payload: number): number {
  let checksum = 0;

  for (let i = 0; i < payload; i++) {
    checksum = (checksum + ((i * 31) % 9973)) % 100000;
  }

  return checksum;
}

function createTaskId(workerId: number): string {
  return `${Date.now().toString(36)}-${workerId.toString(36)}`;
}

function startPrimary(options: ClusterSchedulerDemoOptions): void {
  const cpuCount = Math.max(1, os.cpus().length);
  const workerCount = Math.max(1, Math.min(options.workerCount ?? Math.min(2, cpuCount), cpuCount));
  const pingIntervalMs = Math.max(500, options.pingIntervalMs ?? 5000);

  console.info(`[primary ${process.pid}] start cluster, workers=${workerCount}`);

  const workers = new Map<number, Worker>();

  const attachWorker = (worker: Worker): void => {
    workers.set(worker.id, worker);

    worker.on('message', (rawMessage: ToPrimaryMessage) => {
      if (!isToPrimary(rawMessage)) {
        return;
      }

      if (rawMessage.type === ToPrimaryType.Ready) {
        const taskMessage: RunTaskMessage = {
          type: ToWorkerType.RunTask,
          taskId: createTaskId(worker.id),
          payload: 150_000,
        };
        worker.send(taskMessage);
        return;
      }

      if (rawMessage.type === ToPrimaryType.Pong) {
        const rtt = Date.now() - rawMessage.sentAt;
        console.info(
          `[primary ${process.pid}] pong from worker ${rawMessage.pid}, rtt=${rtt}ms, workerTime=${rawMessage.receivedAt}`,
        );
        return;
      }

      console.info(
        `[primary ${process.pid}] task result from worker ${rawMessage.pid}, task=${rawMessage.taskId}, result=${rawMessage.result}`,
      );
    });

    worker.on('exit', (code, signal) => {
      workers.delete(worker.id);
      console.info(
        `[primary ${process.pid}] worker ${worker.process.pid ?? 'unknown'} exited, code=${code}, signal=${signal ?? 'none'}`,
      );
    });
  };

  for (let i = 0; i < workerCount; i++) {
    attachWorker(cluster.fork());
  }

  const pingTimer = setInterval(() => {
    const ping: PingMessage = {
      type: ToWorkerType.Ping,
      sentAt: Date.now(),
    };

    for (const worker of workers.values()) {
      if (worker.isConnected()) {
        worker.send(ping);
      }
    }
  }, pingIntervalMs);

  pingTimer.unref();

  const shutdown = (): void => {
    clearInterval(pingTimer);

    for (const worker of workers.values()) {
      worker.disconnect();
    }

    setTimeout(() => process.exit(0), 100).unref();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function startWorker(): void {
  console.info(`[worker ${process.pid}] boot`);

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

    const result = runFakeTask(rawMessage.payload);
    sendToPrimary({
      type: ToPrimaryType.TaskResult,
      taskId: rawMessage.taskId,
      pid: process.pid,
      result,
    });
  });
}

export function runClusterSchedulerDemo(options: ClusterSchedulerDemoOptions = {}): void {
  if (cluster.isPrimary) {
    startPrimary(options);
  } else {
    startWorker();
  }
}

runClusterSchedulerDemo();
