import type { PrimaryToWorkerMessageType, WorkerToPrimaryMessageType } from './scheduler.ts';

export interface ClusterSchedulerDemoOptions {
  workerCount?: number;
  pingIntervalMs?: number;
}

export interface PingMessage {
  type: PrimaryToWorkerMessageType.Ping;
  sentAt: number;
}

export interface RunTaskMessage {
  type: PrimaryToWorkerMessageType.RunTask;
  taskId: string;
  payload: number;
}

export type PrimaryToWorkerMessage = PingMessage | RunTaskMessage;

export interface ReadyMessage {
  type: WorkerToPrimaryMessageType.Ready;
  pid: number;
}

export interface PongMessage {
  type: WorkerToPrimaryMessageType.Pong;
  pid: number;
  sentAt: number;
  receivedAt: number;
}

export interface TaskResultMessage {
  type: WorkerToPrimaryMessageType.TaskResult;
  taskId: string;
  pid: number;
  result: number;
}

export type WorkerToPrimaryMessage = ReadyMessage | PongMessage | TaskResultMessage;
