import fs from 'node:fs';
import path from 'node:path';
import type { LoggerOption } from '@/common/logger.js';
import type { InjectionConfig } from '@/common/types.js';
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

  if (typeof https !== 'object' || https === null || Array.isArray(https)) {
    $throw('FluxionOptions.https must be an object');
  }
  if (typeof https.key !== 'string') {
    $throw('FluxionOptions.https.key must be a string');
  }
  if (typeof https.cert !== 'string') {
    $throw('FluxionOptions.https.cert must be a string');
  }

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
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    $throw('FluxionOptions must be an object');
  }

  let {
    dir,
    host,
    port,
    metaPort,
    injections = [],
    moduleDir = process.cwd(),
    workerOptions = {},
    maxRequestBytes = 8_000_000,
    reloadDelay = 500,
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
    nativeWatcher = false,
  } = options as FluxionOptions;
  const logger = options.logger ?? 'one-line';
  if (
    logger !== 'one-line' &&
    logger !== 'json-line' &&
    (typeof logger !== 'object' ||
      logger === null ||
      Array.isArray(logger) ||
      typeof logger.modulePath !== 'string' ||
      typeof logger.name !== 'string')
  ) {
    $throw(`Invalid logger option, must be 'one-line', 'json-line' or { modulePath: string; name: string; }`);
  }

  if (typeof dir !== 'string') {
    $throw('FluxionOptions.dir must be a string');
  }

  if (typeof moduleDir !== 'string') {
    $throw('FluxionOptions.moduleDir must be a string');
  }

  if (typeof host !== 'string') {
    $throw('FluxionOptions.host must be a string');
  }

  if (typeof reloadDelay !== 'number' || reloadDelay <= 0 || !Number.isSafeInteger(reloadDelay)) {
    $throw('FluxionOptions.reloadDelay must be a positive integer');
  }

  if (reloadDelay < 50) {
    $throw('FluxionOptions.reloadDelay must be greater than or equal to 50');
  }

  if (typeof port !== 'number' || !Number.isSafeInteger(port)) {
    $throw('FluxionOptions.port must be a positive integer');
  }

  if (port <= 1 || port > 65535) {
    $throw('FluxionOptions.port must be 1 ~ 65535');
  }

  metaPort ??= port + 1;
  if (typeof metaPort !== 'number' || !Number.isSafeInteger(metaPort)) {
    $throw('FluxionOptions.metaPort must be a positive integer');
  }

  if (metaPort <= 1 || metaPort > 65535) {
    $throw('FluxionOptions.metaPort must be 1 ~ 65535');
  }

  if (metaPort === port) {
    $throw('FluxionOptions.metaPort must be different from FluxionOptions.port');
  }

  if (
    !Array.isArray(injections) ||
    injections.some((item) => typeof item !== 'object' || item === null || Array.isArray(item))
  ) {
    $throw('FluxionOptions.injections must be an array of objects');
  }

  if (typeof workerOptions !== 'object' || workerOptions === null || Array.isArray(workerOptions)) {
    $throw('FluxionOptions.workerOptions must be an object');
  }

  if (typeof maxRequestBytes !== 'number' || maxRequestBytes <= 0 || !Number.isSafeInteger(maxRequestBytes)) {
    $throw('FluxionOptions.maxRequestBytes must be a positive integer');
  }

  dir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
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
    nativeWatcher,
    https: normalizeHttpsOptions(https, moduleDir),
  };
}
