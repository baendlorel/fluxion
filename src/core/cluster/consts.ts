import type { PrimaryMessage as PrimaryMessage, WorkerMessage as WorkerMessage } from './types.js';

export const enum PrimaryAction {
  /**
   * Health check message, the worker should respond with Pong and the latency information
   */
  Ping = 100,

  /**
   * Send fluxion options to worker
   */
  SendFluxionOptions,
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
}

export const isPrimaryMessage = (v: PrimaryMessage): v is PrimaryMessage =>
  [PrimaryAction.Ping, PrimaryAction.SendFluxionOptions].includes(v?.type);

export const isWorkerMessage = (v: WorkerMessage): v is WorkerMessage =>
  [WorkerAction.Pong, WorkerAction.Created, WorkerAction.Ready].includes(v?.type);
