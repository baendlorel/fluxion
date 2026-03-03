import { whether } from '@/common/expect.js';
import type { MessageToWorker, MessageToPrimary } from './types.js';

export const enum ToWorkerMessageType {
  Ping = 100,
  RunTask,
}

export const enum ToPrimaryMessageType {
  Ready = 200,
  Pong,
  TaskResult,
}

export const isToWorker = (value: unknown): value is MessageToWorker => {
  if (!whether.isObject(value) || 'type' in value === false) {
    return false;
  }

  if (value.type === ToWorkerMessageType.Ping) {
    return typeof value.sentAt === 'number';
  }

  if (value.type === ToWorkerMessageType.RunTask) {
    return typeof value.taskId === 'string' && typeof value.payload === 'number';
  }

  return false;
};

export const isToPrimary = (value: unknown): value is MessageToPrimary => {
  if (!whether.isObject(value) || 'type' in value === false) {
    return false;
  }

  if (value.type === ToPrimaryMessageType.Ready) {
    return typeof value.pid === 'number';
  }

  if (value.type === ToPrimaryMessageType.Pong) {
    return typeof value.pid === 'number' && typeof value.sentAt === 'number' && typeof value.receivedAt === 'number';
  }

  if (value.type === ToPrimaryMessageType.TaskResult) {
    return typeof value.taskId === 'string' && typeof value.pid === 'number' && typeof value.result === 'number';
  }

  return false;
};
