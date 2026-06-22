import fs from 'node:fs';
import path from 'node:path';
import type { WorkerOptions, NormalizedWorkerOptions, FluxionOptions, NormalizedFluxionOptions } from '../types.js';

/**
 * Resolves worker options with framework defaults. All thresholds become
 * concrete numbers (`Infinity` disables a check) so the primary can evaluate
 * them without null-handling.
 */
function resolveWorkerOptions(options: WorkerOptions = {}): NormalizedWorkerOptions {
  const rw = options.restartWhen ?? {};
  const healthzTimeout = rw.healthzTimeout ?? 30_000;
  // Ping runs every 5s; a threshold below 2x that would recycle healthy workers
  // (a ready worker's lastPongAt is normally ~5s old). Infinity disables.
  if (healthzTimeout !== Infinity && (!Number.isFinite(healthzTimeout) || healthzTimeout < 10_000)) {
    $throw('workerOptions.restartWhen.healthzTimeout must be a finite number >= 10000 (ms) or Infinity');
  }
  return {
    maxWorkerCount: options.maxWorkerCount ?? 4,
    restartWhen: {
      memoryUsageGreaterThan: rw.memoryUsageGreaterThan ?? Infinity,
      healthzTimeout,
      uptimeGreaterThan: rw.uptimeGreaterThan ?? Infinity,
    },
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
    handlerTimeoutMs = 5000,
    staticResourceTimeoutMs = 10 * 600000,
    metaPort,
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
  if (logger !== 'one-line' && logger !== 'json-line' && typeof logger !== 'function') {
    $throw(`Invalid logger option, Must be 'one-line', 'json-line' or a custom logger function`);
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

  if (!Number.isSafeInteger(handlerTimeoutMs) || handlerTimeoutMs <= 100) {
    $throw('FluxionOptions.handlerTimeoutMs must be an integer greater than 100');
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
    handlerTimeoutMs,
    staticResourceTimeoutMs,
    reloadDelay,
    metaPort,
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
