import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

import { HandlerResult, HttpCode } from '@/common/consts.js';
import { getErrorMessage, log, logJsonl } from '@/common/logger.js';
import { createFileRuntime } from '@/workers/file-runtime.js';

import { createMetaApi } from './meta-api.js';

import type { NormalizedRequest } from './types.js';
import { safeSendJson } from './utils/send-json.js';
import { getRealIp } from './utils/headers.js';
import { createBodyPreviewCapture, parseQuery, toURL } from './utils/request.js';

export interface FluxionOptions {
  /**
   * The directory where dynamic files (e.g. uploaded files) will be stored. It will be created if it doesn't exist.
   * It is recommended to use an empty directory that is not used for any other purpose, to avoid potential conflicts or security issues.
   */
  dir: string;

  host: string;

  port: number;
}

export function fluxion(options: FluxionOptions): http.Server {
  const dir = path.resolve(options.dir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logJsonl('INFO', 'dynamic_directory_created', { directory: dir });
  }

  const fileRuntime = createFileRuntime(dir);
  const metaApi = createMetaApi({
    dir,
    getRouteSnapshot: fileRuntime.getRouteSnapshot,
    getWorkerSnapshot: fileRuntime.getWorkerSnapshot,
  });

  void fileRuntime
    .getRouteSnapshot()
    .then((snapshot) => {
      const handlerCount = snapshot.handlers.length;
      const staticFileCount = snapshot.staticFiles.length;

      logJsonl('INFO', 'dynamic_directory_loaded', {
        dir,
        handlerCount,
        staticFileCount,
      });

      if (handlerCount === 0) {
        log('INFO', 'Loaded handler(s): none');
        return;
      }

      for (let i = 0; i < snapshot.handlers.length; i++) {
        const handler = snapshot.handlers[i];
        log('INFO', `Loaded handler: ${handler.route} (${handler.file})`);
      }
    })
    .catch((error) => {
      logJsonl('ERROR', 'dynamic_directory_load_failed', {
        dir,
        error: getErrorMessage(error),
      });
    });

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const ip = getRealIp(req);
    const url = toURL(req.url);
    if (url === undefined) {
      safeSendJson(res, { message: 'Bad Request: req.url is undefined' }, HttpCode.BadRequest);
      return;
    }

    const normalized: NormalizedRequest = {
      method,
      ip,
      url,
      query: parseQuery(url.searchParams),
    };

    const bodyCapture = createBodyPreviewCapture(req);

    logJsonl('INFO', 'request_received', { method, ip, path: url.pathname });

    const start = performance.now();
    res.once('finish', () => {
      const fields: Record<string, unknown> = {
        method,
        ip,
        path: url.pathname,
        status: res.statusCode,
        duration: (performance.now() - start).toFixed(4),
      };

      if (Object.keys(normalized.query).length > 0) {
        fields.query = normalized.query;
      }

      const bodyPreview = bodyCapture.getPreview();
      if (bodyPreview.exists) {
        fields.body = bodyPreview.value;
        fields.bodyBytes = bodyPreview.bytes;
        fields.bodyTruncated = bodyPreview.truncated;
      }

      logJsonl('INFO', 'request_completed', fields);
    });

    void metaApi
      .handleRequest(req, res, normalized)
      .then(async (metaHandled) => {
        if (metaHandled) {
          return;
        }

        const result = await fileRuntime.handleRequest(req, res, normalized);
        if (result === HandlerResult.NotFound) {
          safeSendJson(res, { message: 'Route not found', method, url }, HttpCode.NotFound);
        }
      })
      .catch((error) => {
        logJsonl('ERROR', 'request_failed', { method, ip, path: url.pathname, error: getErrorMessage(error) });

        safeSendJson(res, { message: 'Internal Server Error' }, HttpCode.InternalServerError);
      });
  });

  server.on('close', () => {
    void fileRuntime.close();
    log('INFO', `Server closed at http://${options.host}:${options.port}`);
  });

  server.listen(options.port, options.host, () => {
    log('INFO', `Server started at http://${options.host}:${options.port}`);
    log('INFO', `Dynamic directory: ${dir}`);
  });

  server.on('error', (error) => {
    logJsonl('ERROR', 'server_error', {
      error: getErrorMessage(error),
    });
  });
  return server;
}
