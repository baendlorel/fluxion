import { whether } from '@/common/expect.js';
import type { PrimaryToWorkerMessage, WorkerToPrimaryMessage } from './types.js';

export const enum PrimaryToWorkerMessageType {
  Ping = 100,
  RunTask,
}

export const enum WorkerToPrimaryMessageType {
  Ready = 200,
  Pong,
  TaskResult,
}

export const isFromPrimary = (value: unknown): value is PrimaryToWorkerMessage => {
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
};

export const isFromWorker = (value: unknown): value is WorkerToPrimaryMessage => {
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
};
