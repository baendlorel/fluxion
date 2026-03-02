import { expect } from '@/common/expect.js';
import type { WorkerOptions, FluxionOptions, InjectionConfig, ResolvedFluxionOptions } from './types.js';
import { createLogger } from '@/common/logger.js';

/**
 * Resolves runtime options with framework defaults.
 */
export function resolveWorkerOptions(overrides: Partial<WorkerOptions>): WorkerOptions {
  return {
    requestTimeoutMs: overrides.requestTimeoutMs ?? 3000,
    maxInflight: overrides.maxInflight ?? 64,
    memorySoftLimitMb: overrides.memorySoftLimitMb ?? 96,
    memoryHardLimitMb: overrides.memoryHardLimitMb ?? 128,
    memorySampleIntervalMs: overrides.memorySampleIntervalMs ?? 5000,
    maxOldGenerationSizeMb: overrides.maxOldGenerationSizeMb ?? 128,
    maxYoungGenerationSizeMb: overrides.maxYoungGenerationSizeMb ?? 32,
    stackSizeMb: overrides.stackSizeMb ?? 4,
    maxResponseBytes: overrides.maxResponseBytes ?? 2 * 1024 * 1024,
  };
}

export function normalizeOptions(options: FluxionOptions): ResolvedFluxionOptions {
  let {
    dir,
    host,
    port,
    injections = [],
    workerOptions = {},
    maxRequestBytes = 8_000_000,
    logger = 'one-line',
  } = Object(options) as FluxionOptions;

  expect.isString(dir, 'FluxionOptions.dir must be a string');
  expect.isString(host, 'FluxionOptions.host must be a string');
  expect.isPositiveInteger(port, 'FluxionOptions.port must be a positive integer');
  expect.isObjectArray<InjectionConfig>(injections, 'FluxionOptions.injections must be an array of objects');
  expect.isObject(workerOptions, 'FluxionOptions.workerOptions must be an object');
  expect.isPositiveInteger(maxRequestBytes, 'FluxionOptions.maxRequestBytes must be a positive integer');

  if (typeof logger === 'string') {
    if (logger !== 'one-line' && logger !== 'json-line') {
      throw new Error('FluxionOptions.logger string value must be either "one-line" or "json-line"');
    }
  } else if (typeof logger !== 'function') {
    throw new Error('FluxionOptions.logger must be "one-line", "json-line" or a factory function');
  }

  return {
    dir,
    host,
    port,
    injections,
    workerOptions: resolveWorkerOptions(workerOptions),
    maxRequestBytes,
    logger: createLogger(logger),
  };
}
