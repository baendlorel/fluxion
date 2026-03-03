import http from 'node:http';
import { performance } from 'node:perf_hooks';

import { HandlerResult, HttpCode } from '@/common/consts.js';
import { getErrorMessage } from '@/common/logger.js';

import { createMetaApi } from './meta-api.js';

import type { FluxionOptions, NormalizedRequest } from './types.js';
import { safeSendJson } from './utils/send-json.js';
import { getRealIp } from './utils/headers.js';
import { createBodyPreviewCapture, parseQuery, toURL } from './utils/request.js';
import { normalizeOptions } from './options.js';

export function fluxion(options: FluxionOptions): http.Server;
export function fluxion(rawOptions: FluxionOptions): http.Server {
  const options = normalizeOptions(rawOptions);

  const dir = options.dir;
  const logger = options.logger;

  const fileRuntime = createFileRuntime(dir, {
    // ?? 这里的workeroptions是什么？
    workerOptions: options.workerOptions,
    maxRequestBytes: options.maxRequestBytes,
    logger,
  });

  const metaApiHandler = createMetaApi(options);

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

    logger.info('Req', { method, ip, path: url.pathname });

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

      logger.info('Res', fields);
    });

    void metaApiHandler(req, res, normalized)
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
        logger.error('RequestFailed', { method, ip, path: url.pathname, error: getErrorMessage(error) });

        if ((error as NodeJS.ErrnoException).code === 'REQUEST_BODY_TOO_LARGE') {
          safeSendJson(res, { message: getErrorMessage(error) }, HttpCode.PayloadTooLarge);
          return;
        }

        safeSendJson(res, { message: 'Internal Server Error' }, HttpCode.InternalServerError);
      });
  });

  server.on('close', () => {
    void fileRuntime.close();
    logger.info('ServerClosed', {
      host: options.host,
      port: options.port,
    });
  });

  server.listen(options.port, options.host, () => {
    logger.info('ServerStarted', {
      host: options.host,
      port: options.port,
    });
    logger.info('DynamicDirectory', { directory: dir });
  });

  server.on('error', (error) => {
    logger.error('ServerError', {
      error: getErrorMessage(error),
    });
  });
  return server;
}
