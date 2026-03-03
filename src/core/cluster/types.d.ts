import type cluster from 'node:cluster';
import type { ResolvedFluxionOptions } from '../types.js';
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

export interface OptionsMessage {
  type: typeof ToWorkerType.Options;
  fluxionOptions: ResolvedFluxionOptions;
}

export type ToWorkerMessage = PingMessage | OptionsMessage | RunTaskMessage;

export interface CreatedMessage {
  type: typeof ToPrimaryType.Created;
  pid: number;
}

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
  result: any;
}

export type ToPrimaryMessage = CreatedMessage | ReadyMessage | PongMessage | TaskResultMessage;

export interface WorkerState {
  state: 'creating' | 'created' | 'ready';
  instance: cluster.Worker;
}
