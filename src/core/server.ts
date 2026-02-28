import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

import { HttpCode } from '@/common/consts.js';
import { getErrorMessage, log, logJsonl } from '@/common/logger.js';

import { createFileRuntime } from './file-runtime.js';
import { createMetaApi } from './meta-api.js';

import { safeSendJson } from './utils/send-json.js';
import { getRealIp } from './utils/headers.js';
import { createBodyPreviewCapture, parseRequestTarget } from './utils/request.js';

export interface FluxionOptions {
  /**
   * The directory where dynamic files (e.g. uploaded files) will be stored. It will be created if it doesn't exist.
   * It is recommended to use an empty directory that is not used for any other purpose, to avoid potential conflicts or security issues.
   */
  dir: string;

  host: string;

  port: number;
}

export function ensureDynamicDirectory(dynamicDirectory: string): void {
  if (fs.existsSync(dynamicDirectory)) {
    return;
  }

  fs.mkdirSync(dynamicDirectory, { recursive: true });
  logJsonl('INFO', 'dynamic_directory_created', {
    directory: dynamicDirectory,
  });
}

export function startServer(options: FluxionOptions): http.Server {
  const dir = path.resolve(options.dir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logJsonl('INFO', 'dynamic_directory_created', { directory: dir });
  }

  const fileRuntime = createFileRuntime(dir);
  const metaApi = createMetaApi({
    dir,
    getRouteSnapshot: fileRuntime.getRouteSnapshot,
    onArchiveInstalled: fileRuntime.clearCache,
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
    const realIp = getRealIp(req);
    const requestUrl = req.url ?? undefined;
    const requestTarget = parseRequestTarget(requestUrl);
    const bodyCapture = createBodyPreviewCapture(req);

    log('INFO', `Request ${method} ${requestTarget.path} from ${realIp}`);
    logJsonl('INFO', 'request_received', {
      method,
      ip: realIp,
      url: requestUrl ?? null,
      path: requestTarget.path,
    });

    res.once('finish', () => {
      const fields: Record<string, unknown> = {
        method,
        ip: realIp,
        url: requestUrl ?? null,
        path: requestTarget.path,
        statusCode: res.statusCode,
      };

      if (Object.keys(requestTarget.query).length > 0) {
        fields.query = requestTarget.query;
      }

      const bodyPreview = bodyCapture.getPreview();
      if (bodyPreview.exists) {
        fields.body = bodyPreview.value;
        fields.bodyBytes = bodyPreview.bytes;
        fields.bodyTruncated = bodyPreview.truncated;
      }

      logJsonl('INFO', 'request_completed', fields);
    });

    if (req.url === undefined) {
      safeSendJson(res, HttpCode.BAD_REQUEST, { message: 'Bad Request: req.url is undefined' });
      return;
    }

    void metaApi
      .handleRequest(req, res)
      .then(async (metaHandled) => {
        if (metaHandled) {
          return;
        }

        const runtimeResult = await fileRuntime.handleRequest(req, res);

        if (runtimeResult === 'not_found') {
          safeSendJson(res, HttpCode.NOT_FOUND, {
            message: 'Route not found',
            method: req.method ?? 'GET',
            url: req.url ?? null,
          });
        }
      })
      .catch((error) => {
        logJsonl('ERROR', 'request_failed', {
          method: req.method ?? 'GET',
          url: req.url ?? null,
          error: getErrorMessage(error),
        });

        safeSendJson(res, HttpCode.INTERNAL_SERVER_ERROR, { message: 'Internal Server Error' });
      });
  });

  server.on('close', () => {
    log('INFO', `Server closed at http://${options.host}:${options.port}`);
  });

  server.listen(options.port, options.host, () => {
    log('INFO', `Server started at http://${options.host}:${options.port}`);
    log('INFO', `Dynamic directory: ${dir}`);
  });

  return server;
}
