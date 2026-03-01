export interface WorkerRuntimeOptions {
  requestTimeoutMs: number;
  maxInflight: number;
  memorySoftLimitMb: number;
  memoryHardLimitMb: number;
  memorySampleIntervalMs: number;
  maxOldGenerationSizeMb: number;
  maxYoungGenerationSizeMb: number;
  stackSizeMb: number;
}

export type WorkerRuntimeOptionOverrides = Partial<WorkerRuntimeOptions>;

export const DEFAULT_WORKER_RUNTIME_OPTIONS: WorkerRuntimeOptions = {
  requestTimeoutMs: 3000,
  maxInflight: 64,
  memorySoftLimitMb: 96,
  memoryHardLimitMb: 128,
  memorySampleIntervalMs: 5000,
  maxOldGenerationSizeMb: 128,
  maxYoungGenerationSizeMb: 32,
  stackSizeMb: 4,
};

export function resolveWorkerRuntimeOptions(overrides: WorkerRuntimeOptionOverrides = {}): WorkerRuntimeOptions {
  return {
    requestTimeoutMs: overrides.requestTimeoutMs ?? DEFAULT_WORKER_RUNTIME_OPTIONS.requestTimeoutMs,
    maxInflight: overrides.maxInflight ?? DEFAULT_WORKER_RUNTIME_OPTIONS.maxInflight,
    memorySoftLimitMb: overrides.memorySoftLimitMb ?? DEFAULT_WORKER_RUNTIME_OPTIONS.memorySoftLimitMb,
    memoryHardLimitMb: overrides.memoryHardLimitMb ?? DEFAULT_WORKER_RUNTIME_OPTIONS.memoryHardLimitMb,
    memorySampleIntervalMs: overrides.memorySampleIntervalMs ?? DEFAULT_WORKER_RUNTIME_OPTIONS.memorySampleIntervalMs,
    maxOldGenerationSizeMb: overrides.maxOldGenerationSizeMb ?? DEFAULT_WORKER_RUNTIME_OPTIONS.maxOldGenerationSizeMb,
    maxYoungGenerationSizeMb:
      overrides.maxYoungGenerationSizeMb ?? DEFAULT_WORKER_RUNTIME_OPTIONS.maxYoungGenerationSizeMb,
    stackSizeMb: overrides.stackSizeMb ?? DEFAULT_WORKER_RUNTIME_OPTIONS.stackSizeMb,
  };
}
