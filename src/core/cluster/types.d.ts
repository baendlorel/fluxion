import type { ToWorkerType, ToPrimaryType } from './consts.ts';

export interface ClusterSchedulerDemoOptions {
  workerCount?: number;
  pingIntervalMs?: number;
}

export interface PingMessage {
  type: typeof ToWorkerType.Ping;
  sentAt: number;
}

export interface RunTaskMessage {
  type: typeof ToWorkerType.RunTask;
  taskId: string;
  payload: any;
  pathname: string;
}

export type ToWorkerMessage = PingMessage | RunTaskMessage;

export interface ReadyMessage {
  type: typeof ToPrimaryType.Ready;
  pid: number;
}

export interface PongMessage {
  type: typeof ToPrimaryType.Pong;
  pid: number;
  sentAt: number;
  receivedAt: number;
}

export interface TaskResultMessage {
  type: typeof ToPrimaryType.TaskResult;
  taskId: string;
  pid: number;
  result: number;
}

export type ToPrimaryMessage = ReadyMessage | PongMessage | TaskResultMessage;
