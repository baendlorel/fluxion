import fs from 'node:fs';
import path from 'node:path';
import type { LoggerOption } from '@/common/logger.js';
import type { InjectionConfig } from '@/common/types.js';
import { expect } from '@/common/expect.js';

import type { WorkerOptions, FluxionOptions, NormalizedFluxionOptions } from '../types.js';

/**
 * Resolves runtime options with framework defaults.
 */
function resolveWorkerOptions(options: Partial<WorkerOptions>): WorkerOptions {
  return {
    maxWorkerCount: options.maxWorkerCount ?? 4,
    requestTimeoutMs: options.requestTimeoutMs ?? 3000,
    maxInflight: options.maxInflight ?? 64,
    memorySoftLimitMb: options.memorySoftLimitMb ?? 96,
    memoryHardLimitMb: options.memoryHardLimitMb ?? 128,
    memorySampleIntervalMs: options.memorySampleIntervalMs ?? 5000,
    maxOldGenerationSizeMb: options.maxOldGenerationSizeMb ?? 128,
    maxYoungGenerationSizeMb: options.maxYoungGenerationSizeMb ?? 32,
    stackSizeMb: options.stackSizeMb ?? 4,
    maxResponseBytes: options.maxResponseBytes ?? 2 * 1024 * 1024,
  };
}

function expectLoggerOption(o: InjectionConfig | LoggerOption) {
  if (o === 'one-line' || o === 'json-line') {
    return;
  }
  if (typeof o === 'object' && o !== null && typeof o.modulePath === 'string' && typeof o.name === 'string') {
    return;
  }
  $throw(`Invalid logger option, must be 'one-line', 'json-line' or { modulePath: string; name: string; }`);
}

/**
 * Read certificate content from a file path or return the content directly.
 */
function readCertificateContent(content: string | Buffer, moduleDir: string): Buffer {
  if (Buffer.isBuffer(content)) {
    return content;
  }
  if (typeof content === 'string') {
    // Check if it looks like a file path (not a PEM certificate)
    // PEM certificates start with "-----BEGIN"
    if (!content.startsWith('-----BEGIN')) {
      const filePath = path.isAbsolute(content) ? content : path.join(moduleDir, content);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
    }
    return Buffer.from(content);
  }
  $throw('Certificate content must be a string or Buffer');
}

/**
 * Normalize HTTPS options.
 */
function normalizeHttpsOptions(
  https: FluxionOptions['https'],
  moduleDir: string,
): NormalizedFluxionOptions['https'] | undefined {
  if (!https) {
    return undefined;
  }

  expect.isObject(https, 'FluxionOptions.https must be an object');
  expect.isString(https.key, 'FluxionOptions.https.key must be a string');
  expect.isString(https.cert, 'FluxionOptions.https.cert must be a string');

  const result: NormalizedFluxionOptions['https'] = {
    key: readCertificateContent(https.key, moduleDir),
    cert: readCertificateContent(https.cert, moduleDir),
  };

  if (https.ca !== undefined) {
    if (Array.isArray(https.ca)) {
      result.ca = https.ca.map((item) => readCertificateContent(item, moduleDir));
    } else {
      result.ca = readCertificateContent(https.ca, moduleDir);
    }
  }

  return result;
}

/**
 * Normalize options and create necessary resources like the dynamic directory and logger.
 */
export function normalizeOptions(options: FluxionOptions): NormalizedFluxionOptions {
  expect.isObject(options, 'FluxionOptions must be an object');

  let {
    dir,
    host,
    port,
    metaPort,
    injections = [],
    moduleDir = process.cwd(),
    workerOptions = {},
    maxRequestBytes = 8_000_000,
    reloadDelay = 300,
    include = ['**/*'],
    apiInclude = ['**/*.ts'],
    exclude = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.vscode/**',
      '**/.idea/**',
      '**/*.log',
      '**/.DS_Store',
      '**/coverage/**',
      '**/.nyc_output/**',
      '**/*.tmp',
      '**/*.temp',
    ],
    https,
  } = options as FluxionOptions;
  const logger = options.logger ?? 'one-line';
  expectLoggerOption(logger);

  expect.isString(dir, 'FluxionOptions.dir must be a string');

  expect.isString(moduleDir, 'FluxionOptions.moduleDir must be a string');

  expect.isString(host, 'FluxionOptions.host must be a string');

  expect.isPositiveInteger(reloadDelay, 'FluxionOptions.reloadDelay must be a positive integer');
  if (reloadDelay < 50) {
    $throw('FluxionOptions.reloadDelay must be greater than or equal to 50');
  }

  expect.isPositiveInteger(port, 'FluxionOptions.port must be a positive integer');
  if (port > 65535) {
    $throw('FluxionOptions.port must be less than or equal to 65535');
  }
  metaPort ??= port + 1;
  expect.isPositiveInteger(metaPort, 'FluxionOptions.metaPort must be a positive integer');
  if (metaPort > 65535) {
    $throw('FluxionOptions.metaPort must be less than or equal to 65535');
  }
  if (metaPort === port) {
    $throw('FluxionOptions.metaPort must be different from FluxionOptions.port');
  }
  expect.isObjectArray<InjectionConfig>(injections, 'FluxionOptions.injections must be an array of objects');
  expect.isObject(workerOptions, 'FluxionOptions.workerOptions must be an object');
  expect.isPositiveInteger(maxRequestBytes, 'FluxionOptions.maxRequestBytes must be a positive integer');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return {
    dir,
    host,
    port,
    reloadDelay,
    metaPort,
    injections,
    moduleDir,
    workerOptions: resolveWorkerOptions(workerOptions),
    maxRequestBytes,
    logger,
    include,
    apiInclude,
    exclude,
    https: normalizeHttpsOptions(https, moduleDir),
  };
}
