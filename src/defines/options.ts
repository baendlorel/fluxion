import fs from 'node:fs';
import path from 'node:path';
import type { FluxionOptions, NormalizedFluxionOptions } from '../types.js';
import { OPTIONS_NORMALIZED_FLAG } from '@/common/consts.js';

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
  _throw('Certificate content must be a string or Buffer');
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
    _throw('FluxionOptions.https must be an object');
  }
  if (typeof https.key !== 'string') {
    _throw('FluxionOptions.https.key must be a string');
  }
  if (typeof https.cert !== 'string') {
    _throw('FluxionOptions.https.cert must be a string');
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
export function defineFluxionOptions(o: FluxionOptions): NormalizedFluxionOptions {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) {
    _throw('FluxionOptions must be an object');
  }

  // Check for deprecated 'include' option
  if ('include' in o) {
    _throw(
      'The "include" option has been removed. Please use:\n' +
        '  - "apiInclude" for API handler patterns (default: ["**/*.ts"])\n' +
        '  - "staticInclude" for static resource patterns (default: ["**/*"])\n' +
        'Example migration:\n' +
        '  OLD: { include: ["**/*.ts", "**/*.js"], apiInclude: ["**/*.ts"] }\n' +
        '  NEW: { apiInclude: ["**/*.ts"], staticInclude: ["**/*.js"] }',
    );
  }

  const {
    dir: rawDir,
    host,
    port,
    handlerTimeoutMs = 5000,
    middlewareTimeoutMs = 3000,
    staticResourceTimeoutMs = 10 * 600000,
    moduleDir: rawModuleDir = process.cwd(),
    maxRequestBytes = 8_000_000,
    reloadDelay = 500,
    apiInclude = ['**/*.ts'],
    staticInclude = ['**/*'],
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
    apiMapper = 'remove-ext',
    https,
    nativeWatcher = false,
    metaApis = ['healthz', 'version', 'routes'],
    metaSecret,
    cronjobDir: rawCronjobDir,
    cronjobInclude = ['**/*.ts'],
    cronjobExclude = [],
  } = o as FluxionOptions;

  const logger = o.logger ?? 'one-line';
  if (logger !== 'one-line' && logger !== 'json-line' && typeof logger !== 'function') {
    _throw(`Invalid logger option, Must be 'one-line', 'json-line' or a custom logger function`);
  }

  if (typeof rawDir !== 'string') {
    _throw('FluxionOptions.dir must be a string');
  }
  const dir = path.resolve(rawDir);

  if (typeof rawModuleDir !== 'string') {
    _throw('FluxionOptions.moduleDir must be a string');
  }
  const moduleDir = path.resolve(rawModuleDir);

  let cronjobDir: string | undefined;
  if (rawCronjobDir !== undefined) {
    if (typeof rawCronjobDir !== 'string') {
      _throw('FluxionOptions.cronjobDir must be a string or undefined');
    }
    cronjobDir = path.resolve(rawCronjobDir);
  }

  if (typeof host !== 'string') {
    _throw('FluxionOptions.host must be a string');
  }

  if (!Number.isSafeInteger(handlerTimeoutMs) || handlerTimeoutMs <= 100) {
    _throw('FluxionOptions.handlerTimeoutMs must be an integer greater than 100');
  }

  if (!Number.isSafeInteger(middlewareTimeoutMs) || middlewareTimeoutMs <= 100) {
    _throw('FluxionOptions.middlewareTimeoutMs must be an integer greater than 100');
  }

  if (typeof reloadDelay !== 'number' || reloadDelay <= 0 || !Number.isSafeInteger(reloadDelay)) {
    _throw('FluxionOptions.reloadDelay must be a positive integer');
  }

  if (reloadDelay < 50) {
    _throw('FluxionOptions.reloadDelay must be greater than or equal to 50');
  }

  if (typeof port !== 'number' || !Number.isSafeInteger(port)) {
    _throw('FluxionOptions.port must be a positive integer');
  }

  if (port <= 1 || port > 65535) {
    _throw('FluxionOptions.port must be 1 ~ 65535');
  }

  if (typeof maxRequestBytes !== 'number' || maxRequestBytes <= 0 || !Number.isSafeInteger(maxRequestBytes)) {
    _throw('FluxionOptions.maxRequestBytes must be a positive integer');
  }

  if (
    metaSecret !== undefined &&
    (typeof metaSecret !== 'string' ||
      metaSecret.length < 20 ||
      /\s/.test(metaSecret) ||
      !/[A-Za-z]/.test(metaSecret) ||
      !/\d/.test(metaSecret))
  ) {
    _throw(
      'FluxionOptions.metaSecret must be a string with at least 20 characters, include both letters and digits, and contain no whitespace',
    );
  }

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return {
    dir,
    host,
    port,
    handlerTimeoutMs,
    middlewareTimeoutMs,
    staticResourceTimeoutMs,
    reloadDelay,
    moduleDir,
    maxRequestBytes,
    logger,
    apiInclude,
    staticInclude,
    exclude,
    apiMapper: (() => {
      if (typeof apiMapper === 'function') {
        return apiMapper;
      }
      if (apiMapper === 'identical') {
        return (v) => v;
      }
      if (apiMapper === 'remove-ext') {
        return (filepath: string) => {
          const ext = path.extname(filepath);
          return ext ? filepath.slice(0, -ext.length) : filepath;
        };
      }
      _throw('FluxionOptions.apiMapper must be "identical", "remove-ext", or a function');
    })(),
    nativeWatcher,
    metaApis,
    metaSecret,
    https: normalizeHttpsOptions(https, moduleDir),
    cronjobDir,
    cronjobInclude,
    cronjobExclude,
    // !
    normalizedFlag: OPTIONS_NORMALIZED_FLAG,
  };
}
