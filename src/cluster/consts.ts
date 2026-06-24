import type { PrimaryMessage, WorkerMessage } from './types.js';

export const enum PrimaryAction {
  /**
   * Health check message, the worker should respond with Pong and the latency information
   */
  Ping = 100,

  /**
   * Ask a worker for its current router snapshot.
   */
  Routes,
}

export const enum WorkerAction {
  /**
   * Just created
   */
  Created = 200,

  /**
   * Ready for tasks
   * - fluxion options are injected
   */
  Ready,

  /**
   * Response to Ping, used for health check and latency measurement
   */
  Pong,

  /**
   * Runtime telemetry snapshot from worker process.
   */
  Stats,

  /**
   * Current router snapshot from worker process.
   */
  Routes,
}

export const isPrimaryMessage = (v: PrimaryMessage): v is PrimaryMessage =>
  [PrimaryAction.Ping, PrimaryAction.Routes].includes(v?.type);

export const isWorkerMessage = (v: WorkerMessage): v is WorkerMessage =>
  [WorkerAction.Pong, WorkerAction.Created, WorkerAction.Ready, WorkerAction.Stats, WorkerAction.Routes].includes(
    v?.type,
  );
