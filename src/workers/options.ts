/**
 * Worker runtime tuning options.
 */
export interface ExecutorOptions {
  /**
   * Request timeout in milliseconds.
   */
  requestTimeoutMs: number;
  /**
   * Maximum concurrent requests allowed in the pool.
   */
  maxInflight: number;
  /**
   * Soft heap threshold in MB. Idle worker may restart after crossing it.
   */
  memorySoftLimitMb: number;
  /**
   * ! Hard heap threshold in MB. Worker is restarted once reached.
   */
  memoryHardLimitMb: number;
  /**
   * Memory telemetry interval in milliseconds.
   */
  memorySampleIntervalMs: number;
  /**
   * ! V8 old-generation limit per worker in MB.
   */
  maxOldGenerationSizeMb: number;
  /**
   * ! V8 young-generation limit per worker in MB.
   */
  maxYoungGenerationSizeMb: number;
  /**
   * Worker stack size in MB.
   */
  stackSizeMb: number;
}

/**
 * Resolves runtime options with framework defaults.
 */
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
