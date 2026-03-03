import http from 'node:http';

import { HttpCode } from '@/common/consts.js';
import { getErrorMessage } from '@/common/logger.js';

import type { FluxionHandler, NormalizedRequest, ResolvedFluxionOptions } from './types.js';
import { getRealIp } from './utils/headers.js';
import { toURL, createBodyPreviewCapture } from './utils/request.js';
import { safeSendJson } from './utils/send-json.js';
import { parseBody } from './utils/body.js';
import { parseQuery } from './utils/query.js';

export function createFluxionServer(options: ResolvedFluxionOptions & { handler: FluxionHandler }): http.Server {
  const { logger, handler, maxRequestBytes } = options;

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
      body: {},
    };

    const bodyCapture = createBodyPreviewCapture(req);

    logger.info('Req', { method, ip, path: url.pathname });

    const start = performance.now();
    res.once('finish', () => {
      const fields: Record<string, unknown> = {
        workerId: process.env.WORKER_ID ?? '[primary]',
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

    Promise.try(async () => {
      normalized.body = await parseBody(req, normalized.method, maxRequestBytes);
      await handler(req, res, normalized);
    }).catch((error: NodeJS.ErrnoException) => {
      logger.error('RequestFailed', {
        method: normalized.method,
        ip: normalized.ip,
        path: normalized.url.pathname,
        error: getErrorMessage(error),
      });

      if (error.code === 'REQUEST_BODY_TOO_LARGE') {
        safeSendJson(res, { message: getErrorMessage(error) }, HttpCode.PayloadTooLarge);
        return;
      }

      safeSendJson(res, { message: 'Internal Server Error' }, HttpCode.InternalServerError);
    });
  });

  server.on('close', () => {
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
    logger.info('DynamicDirectory', { directory: options.dir });
  });

  server.on('error', (error) => {
    logger.error('ServerError', {
      error: getErrorMessage(error),
    });
  });

  return server;
}
