export interface ExecutorOptions {
  requestTimeoutMs: number;
  maxInflight: number;
  memorySoftLimitMb: number;
  memoryHardLimitMb: number;
  memorySampleIntervalMs: number;
  maxOldGenerationSizeMb: number;
  maxYoungGenerationSizeMb: number;
  stackSizeMb: number;
}

export function resolveExecutorOptions(overrides: Partial<ExecutorOptions> = {}): ExecutorOptions {
  return {
    requestTimeoutMs: overrides.requestTimeoutMs ?? 3000,
    maxInflight: overrides.maxInflight ?? 64,
    memorySoftLimitMb: overrides.memorySoftLimitMb ?? 96,
    memoryHardLimitMb: overrides.memoryHardLimitMb ?? 128,
    memorySampleIntervalMs: overrides.memorySampleIntervalMs ?? 5000,
    maxOldGenerationSizeMb: overrides.maxOldGenerationSizeMb ?? 128,
    maxYoungGenerationSizeMb: overrides.maxYoungGenerationSizeMb ?? 32,
    stackSizeMb: overrides.stackSizeMb ?? 4,
  };
}
