import http from 'node:http';

import type { NormalizedRequest } from '../types.js';
import { $keys } from '@/common/native.js';
import { HttpCode, META_PREFIX } from '@/common/consts.js';
import { getErrorMessage } from '@/common/logger.js';
import { fluxionOptions, logger } from './global-state.js';

import { getRealIp } from '../utils/headers.js';
import { toURL } from '../utils/request.js';
import { safeSendJson } from '../utils/respond.js';
import { parseBody, type BodyPreview } from '../utils/body.js';
import { parseQuery } from '../utils/query.js';
import { FluxionRouter } from '../router.js';
import { PromiseTry } from '@/common/promise-try.js';

export function createWorkerServer(router: FluxionRouter): http.Server {
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
      if (normalized.url.pathname.startsWith(META_PREFIX + '/')) {
        safeSendJson(res, { message: `Meta APIs are available on port ${fluxionOptions.metaPort}` }, HttpCode.NotFound);
        return;
      }

      const parsed = await parseBody(req, normalized.method, fluxionOptions.maxRequestBytes);
      normalized.body = parsed.body;
      bodyPreview = parsed.preview;

      const handler = await router.getHandler(url);
      if (!handler) {
        safeSendJson(res, { message: 'Not Found' }, HttpCode.NotFound);
        return;
      }

      const result = await PromiseTry(handler, normalized, req, res);
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
      } else {
        safeSendJson(res, { message: 'Internal Server Error' }, HttpCode.InternalServerError);
      }
    }
  });

  server.on('close', () => {
    logger.info('ServerClosed', {
      host: fluxionOptions.host,
      port: fluxionOptions.port,
    });
  });

  server.listen(fluxionOptions.port, fluxionOptions.host, () => {
    logger.info('ServerStarted', {
      pid: process.pid,
      host: fluxionOptions.host,
      port: fluxionOptions.port,
    });
    logger.info('DynamicDirectory', { directory: fluxionOptions.dir });
  });

  server.on('error', (error) => {
    logger.error('ServerError', {
      error: getErrorMessage(error),
    });
  });

  return server;
}
