import type { ToWorkerMessageType, ToPrimaryMessageType } from './consts.ts';

export interface ClusterSchedulerDemoOptions {
  workerCount?: number;
  pingIntervalMs?: number;
}

export interface PingMessage {
  type: ToWorkerMessageType.Ping;
  sentAt: number;
}

export interface RunTaskMessage {
  type: ToWorkerMessageType.RunTask;
  taskId: string;
  payload: number;
}

export type MessageToWorker = PingMessage | RunTaskMessage;

export interface ReadyMessage {
  type: ToPrimaryMessageType.Ready;
  pid: number;
}

export interface PongMessage {
  type: ToPrimaryMessageType.Pong;
  pid: number;
  sentAt: number;
  receivedAt: number;
}

export interface TaskResultMessage {
  type: ToPrimaryMessageType.TaskResult;
  taskId: string;
  pid: number;
  result: number;
}

export type MessageToPrimary = ReadyMessage | PongMessage | TaskResultMessage;
