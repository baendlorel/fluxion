import type cluster from 'node:cluster';
import type { NormalizedFluxionOptions } from '../types.js';
import type { PrimaryAction, WorkerAction } from './consts.ts';

export interface ClusterSchedulerDemoOptions {
  workerCount?: number;
  pingIntervalMs?: number;
}

export interface PingMessage {
  type: PrimaryAction.Ping;
  sentAt: number;
}

export type PrimaryMessage = PingMessage;

export interface CreatedMessage {
  type: WorkerAction.Created;
  pid: number;
}

export interface ReadyMessage {
  type: WorkerAction.Ready;
  pid: number;
}

export interface PongMessage {
  type: WorkerAction.Pong;
  pid: number;
  sentAt: number;
  receivedAt: number;
}

export type WorkerMessage = CreatedMessage | ReadyMessage | PongMessage;

export interface WorkerState {
  state: 'creating' | 'created' | 'ready';
  instance: cluster.Worker;
}
