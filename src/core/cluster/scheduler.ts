import cluster, { type Worker } from 'node:cluster';
import os from 'node:os';
import { whether } from '@/common/expect.js';
import {
  PrimaryToWorkerMessage,
  WorkerToPrimaryMessage,
  ClusterSchedulerDemoOptions,
  RunTaskMessage,
  PingMessage,
} from './types.js';

export const enum PrimaryToWorkerMessageType {
  Ping,
  RunTask,
}

export const enum WorkerToPrimaryMessageType {
  Ready,
  Pong,
  TaskResult,
}

function isPrimaryToWorkerMessage(value: unknown): value is PrimaryToWorkerMessage {
  if (!whether.isObject(value) || 'type' in value === false) {
    return false;
  }

  if (value.type === PrimaryToWorkerMessageType.Ping) {
    return typeof value.sentAt === 'number';
  }

  if (value.type === PrimaryToWorkerMessageType.RunTask) {
    return typeof value.taskId === 'string' && typeof value.payload === 'number';
  }

  return false;
}

function isWorkerToPrimaryMessage(value: unknown): value is WorkerToPrimaryMessage {
  if (!whether.isObject(value) || 'type' in value === false) {
    return false;
  }

  if (value.type === WorkerToPrimaryMessageType.Ready) {
    return typeof value.pid === 'number';
  }

  if (value.type === WorkerToPrimaryMessageType.Pong) {
    return typeof value.pid === 'number' && typeof value.sentAt === 'number' && typeof value.receivedAt === 'number';
  }

  if (value.type === WorkerToPrimaryMessageType.TaskResult) {
    return typeof value.taskId === 'string' && typeof value.pid === 'number' && typeof value.result === 'number';
  }

  return false;
}

function sendToWorker(worker: Worker, message: PrimaryToWorkerMessage): void {
  worker.send(message);
}

function sendToPrimary(message: WorkerToPrimaryMessage): void {
  if (process.send === undefined) {
    return;
  }

  process.send(message);
}

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

    worker.on('message', (rawMessage: unknown) => {
      if (!isWorkerToPrimaryMessage(rawMessage)) {
        return;
      }

      if (rawMessage.type === WorkerToPrimaryMessageType.Ready) {
        const taskMessage: RunTaskMessage = {
          type: PrimaryToWorkerMessageType.RunTask,
          taskId: createTaskId(worker.id),
          payload: 150_000,
        };

        sendToWorker(worker, taskMessage);
        return;
      }

      if (rawMessage.type === WorkerToPrimaryMessageType.Pong) {
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
      type: PrimaryToWorkerMessageType.Ping,
      sentAt: Date.now(),
    };

    for (const worker of workers.values()) {
      if (worker.isConnected()) {
        sendToWorker(worker, ping);
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
    type: WorkerToPrimaryMessageType.Ready,
    pid: process.pid,
  });

  // ?? 这里为什么不是worker on？
  process.on('message', (rawMessage: unknown) => {
    if (!isPrimaryToWorkerMessage(rawMessage)) {
      return;
    }

    if (rawMessage.type === PrimaryToWorkerMessageType.Ping) {
      sendToPrimary({
        type: WorkerToPrimaryMessageType.Pong,
        pid: process.pid,
        sentAt: rawMessage.sentAt,
        receivedAt: Date.now(),
      });
      return;
    }

    const result = runFakeTask(rawMessage.payload);
    sendToPrimary({
      type: WorkerToPrimaryMessageType.TaskResult,
      taskId: rawMessage.taskId,
      pid: process.pid,
      result,
    });
  });
}

export function runClusterSchedulerDemo(options: ClusterSchedulerDemoOptions = {}): void {
  if (cluster.isPrimary) {
    startPrimary(options);
    return;
  }

  startWorker();
}
