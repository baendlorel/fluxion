import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';

import { HandlerResult } from '@/common/consts.js';
import { createLogger } from '@/common/logger.js';
import type { NormalizedRequest } from '@/core/types.js';

import { getFileVersion, streamStaticFile } from './file-system.js';
import {
  buildHandlerCandidates,
  buildStaticCandidates,
  getRouteFromHandlerFile,
  isUnderDirectory,
  normalizeRelativePath,
  parseRequestPath,
} from './path-utils.js';
import {
  applyWorkerResponse,
  normalizeHeaders,
  normalizeRequest,
  readRequestBody,
  resolveMaxRequestBytes,
} from './request-utils.js';
import { buildRouteSnapshot } from './route-snapshot.js';
import type { FileRuntime, FileRuntimeOptions, ParsedPath, ResolvedHandlerFile, WorkerBinding } from './index.js';
import { createWorkerBindings, selectExecutionWorker } from './worker-bindings.js';

/**
 * @param dir Dynamic directory set in `FluxionOptions`
 */
export function createFileRuntime(dir: string, options: FileRuntimeOptions): FileRuntime {
  /**
   * Runtime logger.
   */
  const logger = options.logger ?? createLogger('one-line');

  /**
   * Main-thread view of loaded handler versions.
   */
  const handlerVersions = new Map<string, string>();

  /**
   * Maximum request body bytes accepted by dynamic handlers.
   */
  const maxRequestBytes = resolveMaxRequestBytes(options.maxRequestBytes);

  /**
   * Worker pool bindings used for request routing.
   */
  const workerBindings = createWorkerBindings(options, logger);
  if (workerBindings.length === 0) {
    throw new Error('No worker pools were created for runtime');
  }

  /**
   * Writes load/reload logs for handlers.
   */
  const logHandlerLoad = (filePath: string, version: string, previousVersion?: string): void => {
    const relativeFilePath = normalizeRelativePath(path.relative(dir, filePath));
    const route = getRouteFromHandlerFile(relativeFilePath);

    if (previousVersion === undefined) {
      logger.write('INFO', 'HandlerLoaded', {
        route,
        file: relativeFilePath,
        version,
      });
      return;
    }

    logger.write('INFO', 'HandlerReloaded', {
      route,
      file: relativeFilePath,
      previousVersion,
      version,
    });
  };

  /**
   * Selects target worker for handler execution.
   */
  const resolveExecutionWorker = (_filePath: string, _version: string): WorkerBinding => {
    if (workerBindings.length === 1) {
      return workerBindings[0];
    }

    return selectExecutionWorker(workerBindings);
  };

  /**
   * Resolves the best matching handler for a route.
   */
  const resolveHandlerFile = async (segments: readonly string[]): Promise<ResolvedHandlerFile | undefined> => {
    const candidates = buildHandlerCandidates(dir, segments);

    for (let i = 0; i < candidates.length; i++) {
      const filePath = candidates[i];
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

  /**
   * Executes matched handler inside worker.
   */
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

    const worker = resolveExecutionWorker(resolved.filePath, resolved.version);

    const executeResult = await worker.pool.execute({
      filePath: resolved.filePath,
      version: resolved.version,
      method: normalized.method,
      url: req.url ?? `${normalized.url.pathname}${normalized.url.search}`,
      headers: normalizeHeaders(req.headers),
      body: await readRequestBody(req, normalized.method, maxRequestBytes),
      ip: normalized.ip,
    });

    applyWorkerResponse(res, executeResult.response);

    const previousVersion = handlerVersions.get(resolved.filePath);
    if (previousVersion !== resolved.version) {
      handlerVersions.set(resolved.filePath, resolved.version);
      logHandlerLoad(resolved.filePath, resolved.version, previousVersion);
    }

    return HandlerResult.Handled;
  };

  /**
   * Serves static files when no dynamic handler is matched.
   */
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

    const candidates = buildStaticCandidates(dir, parsedPath.segments);

    for (let i = 0; i < candidates.length; i++) {
      const filePath = candidates[i];

      if (!isUnderDirectory(filePath, dir)) {
        continue;
      }

      if (path.extname(filePath).toLowerCase() === '.mjs') {
        continue;
      }

      try {
        const stat = await fs.promises.stat(filePath);

        if (!stat.isFile()) {
          continue;
        }

        await streamStaticFile(filePath, stat, method, res);
        return HandlerResult.Handled;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;

        if (code === 'ENOENT' || code === 'ENOTDIR') {
          continue;
        }

        throw error;
      }
    }

    return HandlerResult.NotFound;
  };

  return {
    /**
     * Clears version cache and asks all worker pools to rotate.
     */
    clearCache() {
      handlerVersions.clear();

      for (let i = 0; i < workerBindings.length; i++) {
        void workerBindings[i].pool.clearCache();
      }
    },
    /**
     * Closes worker pools.
     */
    async close() {
      await Promise.all(workerBindings.map((worker) => worker.pool.close()));
    },
    /**
     * Returns worker diagnostics for meta api.
     */
    getWorkerSnapshot() {
      return {
        dir,
        workers: workerBindings.map((worker) => worker.pool.getSnapshot()),
      };
    },
    getRouteSnapshot: () => buildRouteSnapshot(dir),
    /**
     * Runtime entrypoint for request handling.
     */
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
