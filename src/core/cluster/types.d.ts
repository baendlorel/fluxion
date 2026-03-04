import type cluster from 'node:cluster';
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

export interface WorkerRuntimeStats {
  at: number;
  pid: number;
  uptimeSeconds: number;
  cpu: {
    userMicros: number;
    systemMicros: number;
    percent: number;
  };
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
}

export interface StatsMessage {
  type: WorkerAction.Stats;
  pid: number;
  stats: WorkerRuntimeStats;
}

export type WorkerMessage = CreatedMessage | ReadyMessage | PongMessage | StatsMessage;

export interface WorkerState {
  state: 'creating' | 'created' | 'ready';
  pid?: number;
  createdAt: number;
  readyAt?: number;
  lastPongAt?: number;
  lastRttMs?: number;
  lastStats?: WorkerRuntimeStats;
  instance: cluster.Worker;
}
