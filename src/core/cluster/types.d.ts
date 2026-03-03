import type { ToWorkerMessageType, ToPrimaryMessageType } from './consts.ts';

export interface ClusterSchedulerDemoOptions {
  workerCount?: number;
  pingIntervalMs?: number;
}

export interface PingMessage {
  type: typeof ToWorkerMessageType.Ping;
  sentAt: number;
}

export interface RunTaskMessage {
  type: typeof ToWorkerMessageType.RunTask;
  taskId: string;
  payload: number;
}

export type ToWorkerMessage = PingMessage | RunTaskMessage;

export interface ReadyMessage {
  type: typeof ToPrimaryMessageType.Ready;
  pid: number;
}

export interface PongMessage {
  type: typeof ToPrimaryMessageType.Pong;
  pid: number;
  sentAt: number;
  receivedAt: number;
}

export interface TaskResultMessage {
  type: typeof ToPrimaryMessageType.TaskResult;
  taskId: string;
  pid: number;
  result: number;
}

export type ToPrimaryMessage = ReadyMessage | PongMessage | TaskResultMessage;
