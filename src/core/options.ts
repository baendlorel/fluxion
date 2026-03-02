import { expect } from '@/common/expect.js';
import type { FluxionOptions, InjectionConfig } from './types.js';

export function normalizeOptions(options: FluxionOptions): Required<FluxionOptions> {
  let {
    dir,
    host,
    port,
    injections = [],
    workerOptions = {},
    maxRequestBytes = 8_000_000,
    logger = 'one-line',
  } = Object(options);

  expect.isString(dir, 'FluxionOptions.dir must be a string');
  expect.isString(host, 'FluxionOptions.host must be a string');
  expect.isNumber(port, 'FluxionOptions.port must be a number');
  expect.isObjectArray<InjectionConfig>(injections, 'FluxionOptions.injections must be an array of objects');
  expect.isObject(workerOptions, 'FluxionOptions.workerOptions must be an object');
  expect.isNumber(maxRequestBytes, 'FluxionOptions.maxRequestBytes must be a number');

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
    workerOptions,
    maxRequestBytes,
    logger,
  };
}
