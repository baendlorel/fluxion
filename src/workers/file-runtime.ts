import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';

import { HandlerResult, STATIC_CONTENT_TYPES } from '@/common/consts.js';
import { log, logJsonl } from '@/common/logger.js';
import type { NormalizedRequest } from '@/core/types.js';
import { parseQuery, toURL } from '@/core/utils/request.js';

import { createHandlerWorkerPool } from './handler-worker-pool.js';
import type { HandlerWorkerSnapshot } from './handler-worker-pool.js';
import type { protocol } from './protocol.js';

interface ParsedPath {
  pathname: string;
  segments: string[];
}

interface ResolvedHandlerFile {
  filePath: string;
  version: string;
}

interface RouteEntryBase {
  file: string;
  version: string;
}

export interface HandlerRouteEntry extends RouteEntryBase {
  route: string;
}

export interface StaticRouteEntry extends RouteEntryBase {
  route: string;
}

export interface FileRouteSnapshot {
  handlers: HandlerRouteEntry[];
  staticFiles: StaticRouteEntry[];
}

export interface FileWorkerSnapshot {
  dir: string;
  workers: HandlerWorkerSnapshot[];
}

export interface FileRuntime {
  clearCache(): void;
  close(): Promise<void>;
  getRouteSnapshot(): Promise<FileRouteSnapshot>;
  getWorkerSnapshot(): FileWorkerSnapshot;
  handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    normalized?: NormalizedRequest,
  ): Promise<HandlerResult>;
}

function getContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return STATIC_CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function isUnderDirectory(targetPath: string, rootDirectory: string): boolean {
  const relativePath = path.relative(rootDirectory, targetPath);
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isIgnoredSegment(segment: string): boolean {
  return segment.startsWith('_');
}

function parseRequestPath(url: URL): ParsedPath | undefined {
  const pathname = url.pathname;
  const rawSegments = pathname.split('/').filter(Boolean);
  const segments: string[] = [];

  for (const rawSegment of rawSegments) {
    let segment: string;

    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return undefined;
    }

    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
      isIgnoredSegment(segment)
    ) {
      return undefined;
    }

    segments.push(segment);
  }

  return { pathname, segments };
}

async function getFileVersion(filePath: string): Promise<string | undefined> {
  try {
    const stat = await fs.promises.stat(filePath);

    if (!stat.isFile()) {
      return undefined;
    }

    return `${stat.mtimeMs}:${stat.size}`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return undefined;
    }

    throw error;
  }
}

function toPublicRoute(relativePath: string): string {
  if (relativePath.length === 0) {
    return '/';
  }

  return `/${normalizeRelativePath(relativePath)}`;
}

function getRouteFromHandlerFile(relativePath: string): string {
  const normalizedRelativePath = normalizeRelativePath(relativePath);

  if (normalizedRelativePath === 'index.mjs') {
    return '/';
  }

  if (normalizedRelativePath.endsWith('/index.mjs')) {
    const routePath = normalizedRelativePath.slice(0, -'/index.mjs'.length);
    return toPublicRoute(routePath);
  }

  if (normalizedRelativePath.endsWith('.mjs')) {
    const routePath = normalizedRelativePath.slice(0, -'.mjs'.length);
    return toPublicRoute(routePath);
  }

  return toPublicRoute(normalizedRelativePath);
}

function buildHandlerCandidates(dynamicDirectory: string, segments: readonly string[]): string[] {
  if (segments.length === 0) {
    return [path.resolve(dynamicDirectory, 'index.mjs')];
  }

  const routePath = path.resolve(dynamicDirectory, ...segments);

  return [path.resolve(routePath, 'index.mjs'), `${routePath}.mjs`];
}

async function streamStaticFile(
  filePath: string,
  stat: fs.Stats,
  method: string | undefined,
  res: http.ServerResponse,
): Promise<void> {
  res.statusCode = 200;
  res.setHeader('Content-Type', getContentType(filePath));
  res.setHeader('Content-Length', String(stat.size));

  if (method === 'HEAD') {
    res.end();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

function normalizeRequest(req: http.IncomingMessage, normalized?: NormalizedRequest): NormalizedRequest | undefined {
  if (normalized !== undefined) {
    return normalized;
  }

  const url = toURL(req.url);
  if (url === undefined) {
    return undefined;
  }

  const socket = req.socket as { remoteAddress?: string | undefined } | undefined;

  return {
    method: req.method ?? 'GET',
    ip: socket?.remoteAddress ?? 'unknown',
    url,
    query: parseQuery(url.searchParams),
  };
}

function normalizeHeaders(headers: http.IncomingHttpHeaders): protocol.Headers {
  const serializedHeaders: protocol.Headers = {};

  const headerKeys = Object.keys(headers);
  for (let i = 0; i < headerKeys.length; i++) {
    const key = headerKeys[i];
    const value = headers[key];

    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      serializedHeaders[key] = value;
      continue;
    }

    serializedHeaders[key] = value;
  }

  return serializedHeaders;
}

async function readRequestBody(req: http.IncomingMessage, method: string): Promise<Uint8Array | undefined> {
  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }

  if (req.readableEnded) {
    return undefined;
  }

  return new Promise<Uint8Array | undefined>((resolve, reject) => {
    const chunks: Buffer[] = [];

    const cleanup = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
    };

    const onData = (chunk: Buffer | string): void => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };

    const onEnd = (): void => {
      cleanup();

      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }

      resolve(Buffer.concat(chunks));
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const onAborted = (): void => {
      cleanup();
      reject(new Error('request aborted while reading body'));
    };

    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
  });
}

function applyWorkerResponse(res: http.ServerResponse, response: protocol.SerializedResponse): void {
  res.statusCode = response.statusCode;

  const headerKeys = Object.keys(response.headers);
  for (let i = 0; i < headerKeys.length; i++) {
    const key = headerKeys[i];
    res.setHeader(key, response.headers[key]);
  }

  if (response.body === undefined || response.body.byteLength === 0) {
    res.end();
    return;
  }

  res.end(Buffer.from(response.body));
}

/**
 * @param dir Dynamic directory set in `FluxionOptions`
 */
export function createFileRuntime(dir: string): FileRuntime {
  const handlerVersions = new Map<string, string>();

  const handlerWorkerPool = createHandlerWorkerPool();

  const logHandlerLoad = (filePath: string, version: string, previousVersion?: string): void => {
    const relativeFilePath = normalizeRelativePath(path.relative(dir, filePath));
    const route = getRouteFromHandlerFile(relativeFilePath);

    if (previousVersion === undefined) {
      log('INFO', `Loaded handler: ${route} (${relativeFilePath})`);
      logJsonl('INFO', 'handler_loaded', {
        route,
        file: relativeFilePath,
        version,
      });
      return;
    }

    log('INFO', `Reloaded handler: ${route} (${relativeFilePath})`);
    logJsonl('INFO', 'handler_reloaded', {
      route,
      file: relativeFilePath,
      previousVersion,
      version,
    });
  };

  const resolveHandlerFile = async (segments: readonly string[]): Promise<ResolvedHandlerFile | undefined> => {
    const candidates = buildHandlerCandidates(dir, segments);

    for (const filePath of candidates) {
      if (!isUnderDirectory(filePath, dir)) {
        continue;
      }

      const version = await getFileVersion(filePath);

      if (version !== undefined) {
        return { filePath, version };
      }
    }

    return undefined;
  };

  const tryHandleHandler = async (
    parsedPath: ParsedPath,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    normalized: NormalizedRequest,
  ): Promise<HandlerResult> => {
    if (parsedPath.pathname.endsWith('.mjs')) {
      return HandlerResult.NotFound;
    }

    const resolved = await resolveHandlerFile(parsedPath.segments);

    if (resolved === undefined) {
      return HandlerResult.NotFound;
    }

    const response = await handlerWorkerPool.execute({
      filePath: resolved.filePath,
      version: resolved.version,
      method: normalized.method,
      url: req.url ?? `${normalized.url.pathname}${normalized.url.search}`,
      headers: normalizeHeaders(req.headers),
      body: await readRequestBody(req, normalized.method),
      ip: normalized.ip,
    });

    applyWorkerResponse(res, response);

    const previousVersion = handlerVersions.get(resolved.filePath);
    if (previousVersion !== resolved.version) {
      handlerVersions.set(resolved.filePath, resolved.version);
      logHandlerLoad(resolved.filePath, resolved.version, previousVersion);
    }

    return HandlerResult.Handled;
  };

  const tryHandleStatic = async (
    parsedPath: ParsedPath,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    normalized: NormalizedRequest,
  ): Promise<HandlerResult> => {
    const method = normalized.method;

    if (method !== 'GET' && method !== 'HEAD') {
      return HandlerResult.NotFound;
    }

    if (parsedPath.segments.length === 0) {
      return HandlerResult.NotFound;
    }

    const filePath = path.resolve(dir, ...parsedPath.segments);

    if (!isUnderDirectory(filePath, dir)) {
      return HandlerResult.NotFound;
    }

    if (path.extname(filePath).toLowerCase() === '.mjs') {
      return HandlerResult.NotFound;
    }

    try {
      const stat = await fs.promises.stat(filePath);

      if (!stat.isFile()) {
        return HandlerResult.NotFound;
      }

      await streamStaticFile(filePath, stat, method, res);
      return HandlerResult.Handled;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return HandlerResult.NotFound;
      }

      throw error;
    }
  };

  const getRouteSnapshot = async (): Promise<FileRouteSnapshot> => {
    const handlerByRoute = new Map<string, { entry: HandlerRouteEntry; priority: number }>();
    const staticFiles: StaticRouteEntry[] = [];

    const readEntries = async (directory: string): Promise<fs.Dirent[]> => {
      try {
        return await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;

        if (code === 'ENOENT' || code === 'ENOTDIR') {
          return [];
        }

        throw error;
      }
    };

    const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
      const entries = await readEntries(directory);

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.isDirectory()) {
          if (isIgnoredSegment(entry.name)) {
            continue;
          }

          const childDirectory = path.join(directory, entry.name);
          const childRelativeDirectory = path.join(relativeDirectory, entry.name);
          await walk(childDirectory, childRelativeDirectory);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const absolutePath = path.join(directory, entry.name);
        const relativePath = path.join(relativeDirectory, entry.name);
        const version = await getFileVersion(absolutePath);

        if (version === undefined) {
          continue;
        }

        if (entry.name.endsWith('.mjs')) {
          const route = getRouteFromHandlerFile(relativePath);
          const entryItem: HandlerRouteEntry = {
            route,
            file: normalizeRelativePath(relativePath),
            version,
          };
          const priority = entry.name === 'index.mjs' ? 0 : 1;
          const existing = handlerByRoute.get(route);

          if (existing === undefined || priority < existing.priority) {
            handlerByRoute.set(route, { entry: entryItem, priority });
          }

          continue;
        }

        staticFiles.push({
          route: toPublicRoute(relativePath),
          file: normalizeRelativePath(relativePath),
          version,
        });
      }
    };

    await walk(dir, '');

    const handlers = Array.from(handlerByRoute.values())
      .map((item) => item.entry)
      .sort((left, right) => left.route.localeCompare(right.route));

    staticFiles.sort((left, right) => left.route.localeCompare(right.route));

    return {
      handlers,
      staticFiles,
    };
  };

  return {
    clearCache() {
      handlerVersions.clear();
      void handlerWorkerPool.clearCache();
    },
    async close() {
      await handlerWorkerPool.close();
    },
    getWorkerSnapshot() {
      return {
        dir,
        workers: [handlerWorkerPool.getSnapshot()],
      };
    },
    getRouteSnapshot,
    async handleRequest(
      req: http.IncomingMessage,
      res: http.ServerResponse,
      normalized?: NormalizedRequest,
    ): Promise<HandlerResult> {
      const resolvedNormalized = normalizeRequest(req, normalized);
      if (resolvedNormalized === undefined) {
        return HandlerResult.NotFound;
      }

      const parsedPath = parseRequestPath(resolvedNormalized.url);
      if (parsedPath === undefined) {
        return HandlerResult.NotFound;
      }

      const handlerResult = await tryHandleHandler(parsedPath, req, res, resolvedNormalized);
      if (handlerResult === HandlerResult.Handled) {
        return HandlerResult.Handled;
      }

      return tryHandleStatic(parsedPath, req, res, resolvedNormalized);
    },
  };
}
