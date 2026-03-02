import fs, { existsSync } from 'node:fs';
import { expect } from '@/common/expect.js';
import { createLogger } from '@/common/logger.js';

import type { WorkerOptions, FluxionOptions, InjectionConfig, ResolvedFluxionOptions } from './types.js';

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

/**
 * Normalize options and create necessary resources like the dynamic directory and logger.
 */
export function normalizeOptions(options: FluxionOptions): ResolvedFluxionOptions {
  expect.isObject(options, 'FluxionOptions must be an object');

  let { dir, host, port, injections = [], workerOptions = {}, maxRequestBytes = 8_000_000 } = options as FluxionOptions;
  const logger = createLogger(options.logger); // & assertion of logger options lies within createLogger

  expect.isString(dir, 'FluxionOptions.dir must be a string');
  expect.isString(host, 'FluxionOptions.host must be a string');
  expect.isPositiveInteger(port, 'FluxionOptions.port must be a positive integer');
  expect.isObjectArray<InjectionConfig>(injections, 'FluxionOptions.injections must be an array of objects');
  expect.isObject(workerOptions, 'FluxionOptions.workerOptions must be an object');
  expect.isPositiveInteger(maxRequestBytes, 'FluxionOptions.maxRequestBytes must be a positive integer');

  if (!existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info('DynamicDirectoryCreated', { directory: dir });
  }

  return {
    dir,
    host,
    port,
    injections,
    workerOptions: resolveWorkerOptions(workerOptions),
    maxRequestBytes,
    logger,
  };
}
