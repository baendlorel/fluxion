import type { ToWorkerMessage, ToPrimaryMessage } from './types.js';

export namespace ToWorkerType {
  export const Ping = Symbol();
  export const RunTask = Symbol();
  export const List = [Ping, RunTask] as const;
}

export namespace ToPrimaryType {
  export const Ready = Symbol();
  export const Pong = Symbol();
  export const TaskResult = Symbol();
  export const List = [Ready, Pong, TaskResult] as const;
}

export const isToWorker = (value: ToWorkerMessage): value is ToWorkerMessage => ToWorkerType.List.includes(value?.type);

export const isToPrimary = (value: ToPrimaryMessage): value is ToPrimaryMessage =>
  ToPrimaryType.List.includes(value?.type);
