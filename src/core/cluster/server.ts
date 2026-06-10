import http from 'node:http';
import https from 'node:https';

import type { FluxionContext, NormalizedRequest } from '../types.js';
import { $keys } from '@/common/native.js';
import { HttpCode, META_PREFIX } from '@/common/consts.js';
import { getErrorMessage } from '@/common/logger.js';

import { getRealIp } from '../utils/headers.js';
import { toURL } from '../utils/request.js';
import { safeSendJson } from '../utils/respond.js';
import { parseBody, type BodyPreview } from '../utils/body.js';
import { parseQuery } from '../utils/query.js';
import { parseCookie } from '../utils/cookie.js';
import { PromiseTry } from '@/common/promise-try.js';

export function createWorkerServer(cx: FluxionContext): http.Server | https.Server {
  const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
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
      headers: req.headers,
      cookie: parseCookie(req.headers.cookie as string | undefined),
    };

    let bodyPreview: BodyPreview = {
      exists: false,
      bytes: 0,
      truncated: false,
    };

    cx.logger.info('Req', { method, ip, path: url.pathname });

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

      cx.logger.info('Res', fields);
    });

    // * Start request handling
    try {
      if (normalized.url.pathname.startsWith(META_PREFIX + '/')) {
        safeSendJson(res, { message: `Meta APIs are available on port ${cx.options.metaPort}` }, HttpCode.NotFound);
        return;
      }

      const parsed = await parseBody(req, normalized.method, cx.options.maxRequestBytes);
      normalized.body = parsed.body;
      bodyPreview = parsed.preview;

      const handler = await cx.router.getHandler(url);
      if (!handler) {
        safeSendJson(res, { message: 'Not Found' }, HttpCode.NotFound);
        return;
      }

      const result = await PromiseTry(handler, normalized, req, res);

      if (result !== cx.router.StaticHandled) {
        safeSendJson(res, result);
      }
    } catch (error) {
      cx.logger.error('RequestFailed', {
        method: normalized.method,
        ip: normalized.ip,
        path: normalized.url.pathname,
        error: getErrorMessage(error),
      });

      if ((error as NodeJS.ErrnoException).code === 'REQUEST_BODY_TOO_LARGE') {
        safeSendJson(res, { message: getErrorMessage(error) }, HttpCode.PayloadTooLarge);
      } else {
        safeSendJson(res, { message: getErrorMessage(error) }, HttpCode.InternalServerError);
      }
    }
  };

  const server = cx.options.https
    ? https.createServer(
        {
          key: cx.options.https.key,
          cert: cx.options.https.cert,
          ca: cx.options.https.ca,
        },
        requestHandler,
      )
    : http.createServer(requestHandler);

  server.on('close', () => {
    cx.logger.info('ServerClosed', {
      host: cx.options.host,
      port: cx.options.port,
    });
  });

  server.listen(cx.options.port, cx.options.host, () => {
    cx.logger.info('ServerStarted', {
      pid: process.pid,
      protocol: cx.options.https ? 'https' : 'http',
      host: cx.options.host,
      port: cx.options.port,
    });
    cx.logger.info('DynamicDirectory', { directory: cx.options.dir });
  });

  server.on('error', (error) => {
    cx.logger.error('ServerError', {
      error: getErrorMessage(error),
    });
  });

  return server;
}
