import type cluster from 'node:cluster';
import type { PrimaryAction, WorkerAction } from './consts.js';
import type { FluxionRouteMeta } from '../types.js';

export interface ClusterSchedulerDemoOptions {
  workerCount?: number;
  pingIntervalMs?: number;
}

export interface PingMessage {
  type: PrimaryAction.Ping;
  sentAt: number;
}

export interface RoutesRequestMessage {
  type: PrimaryAction.Routes;
  requestId: number;
}

export type PrimaryMessage = PingMessage | RoutesRequestMessage;

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

export interface RoutesMessage {
  type: WorkerAction.Routes;
  pid: number;
  requestId: number;
  routes: FluxionRouteMeta[];
}

export type WorkerMessage = CreatedMessage | ReadyMessage | PongMessage | StatsMessage | RoutesMessage;

export interface WorkerState {
  /**
   * `restarting` marks a worker the primary is proactively recycling
   * (via restartWhen) so its exit is expected and a replacement is spawned.
   */
  state: 'creating' | 'created' | 'ready' | 'restarting';
  pid?: number;
  /**
   * Stable 1-based slot index (the WORKER_ID env). Survives fork cycles,
   * unlike cluster's `worker.id` which changes on every fork — used as the
   * key for restart history / anti-storm tracking.
   */
  slot: number;
  createdAt: number;
  readyAt?: number;
  lastPongAt?: number;
  lastRttMs?: number;
  lastStats?: WorkerRuntimeStats;
  /** Human-readable reason this worker is being / was last recycled. */
  restartReason?: string;
  instance: cluster.Worker;
}
