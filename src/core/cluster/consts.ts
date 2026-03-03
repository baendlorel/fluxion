import type { ToWorkerMessage, ToPrimaryMessage } from './types.js';

export namespace ToWorkerType {
  /**
   * Health check message, the worker should respond with Pong and the latency information
   */
  export const Ping = Symbol();

  /**
   * Send fluxion options to worker
   */
  export const Options = Symbol();

  /**
   * Run a task, the payload should contain all necessary information to run the task
   */
  export const RunTask = Symbol();

  export const List = [Ping, RunTask, Options] as const;
}

export namespace ToPrimaryType {
  /**
   * Just created
   */
  export const Created = Symbol();

  /**
   * Ready for tasks
   * - fluxion options are injected
   */
  export const Ready = Symbol();

  /**
   * Response to Ping, used for health check and latency measurement
   */
  export const Pong = Symbol();

  /**
   * Result of a task
   */
  export const TaskResult = Symbol();

  export const List = [Created, Ready, Pong, TaskResult] as const;
}

export const isToWorker = (v: ToWorkerMessage): v is ToWorkerMessage => ToWorkerType.List.includes(v?.type);
export const isToPrimary = (v: ToPrimaryMessage): v is ToPrimaryMessage => ToPrimaryType.List.includes(v?.type);
