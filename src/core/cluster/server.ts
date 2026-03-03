import http from 'node:http';

import type { NormalizedRequest, NormalizedFluxionOptions } from '../types.js';
import { $keys } from '@/common/native.js';
import { HttpCode } from '@/common/consts.js';
import { getErrorMessage } from '@/common/logger.js';

import { getRealIp } from '../utils/headers.js';
import { toURL } from '../utils/request.js';
import { safeSendJson } from '../utils/respond.js';
import { parseBody, type BodyPreview } from '../utils/body.js';
import { parseQuery } from '../utils/query.js';
import { createMetaApiHandler } from './meta-api.js';

export function createServer(options: NormalizedFluxionOptions): http.Server {
  const { logger, maxRequestBytes } = options;

  const metaApiHandler = createMetaApiHandler();
  const server = http.createServer(async (req, res) => {
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

    let bodyPreview: BodyPreview = {
      exists: false,
      bytes: 0,
      truncated: false,
    };

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

      if ($keys(normalized.query).length > 0) {
        fields.query = normalized.query;
      }

      if (bodyPreview.exists) {
        fields.body = bodyPreview.value;
        fields.bodyBytes = bodyPreview.bytes;
        fields.bodyTruncated = bodyPreview.truncated;
      }

      logger.info('Res', fields);
    });

    // * Start request handling
    try {
      const isMetaApiHandled = await metaApiHandler(req, res, normalized);
      if (isMetaApiHandled) {
        return;
      }

      const parsed = await parseBody(req, normalized.method, maxRequestBytes);
      normalized.body = parsed.body;
      bodyPreview = parsed.preview;

      // todo 匹配url到精确的handler
      const result = await Promise.try(handler, req, res, normalized);
      safeSendJson(res, result);
    } catch (error) {
      logger.error('RequestFailed', {
        method: normalized.method,
        ip: normalized.ip,
        path: normalized.url.pathname,
        error: getErrorMessage(error),
      });

      if ((error as NodeJS.ErrnoException).code === 'REQUEST_BODY_TOO_LARGE') {
        safeSendJson(res, { message: getErrorMessage(error) }, HttpCode.PayloadTooLarge);
        return;
      }

      safeSendJson(res, { message: 'Internal Server Error' }, HttpCode.InternalServerError);
    }
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
