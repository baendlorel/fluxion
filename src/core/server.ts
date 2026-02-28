import http from 'node:http';
import path from 'node:path';

import { getErrorMessage, log, logJsonl } from '../common/logger.js';
import { ensureDynamicDirectory } from './dynamic-directory.js';
import { createFileRuntime } from './file-runtime.js';
import { createMetaApi } from './meta-api.js';
import { sendJson } from './response.js';

export interface ServerOptions {
  dynamicDirectory: string;
  host: string;
  port: number;
}

function safeSendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  if (res.writableEnded) {
    return;
  }

  if (res.headersSent) {
    res.end();
    return;
  }

  sendJson(res, statusCode, payload);
}

export function startServer(options: ServerOptions): http.Server {
  const dynamicDirectory = path.resolve(options.dynamicDirectory);
  ensureDynamicDirectory(dynamicDirectory);

  const fileRuntime = createFileRuntime(dynamicDirectory);
  const metaApi = createMetaApi({
    dynamicDirectory,
    getRouteSnapshot: () => fileRuntime.getRouteSnapshot(),
    onArchiveInstalled: () => {
      fileRuntime.clearCache();
    },
  });

  const server = http.createServer((req, res) => {
    if (req.url === undefined) {
      safeSendJson(res, 400, { message: 'Bad Request: req.url is undefined' });
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
          safeSendJson(res, 404, {
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

        safeSendJson(res, 500, { message: 'Internal Server Error' });
      });
  });

  server.on('close', () => {
    log('INFO', `Server closed at http://${options.host}:${options.port}`);
  });

  server.listen(options.port, options.host, () => {
    log('INFO', `Server started at http://${options.host}:${options.port}`);
    log('INFO', `Dynamic directory: ${dynamicDirectory}`);
  });

  return server;
}
