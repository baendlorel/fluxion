import http from 'node:http';
import https from 'node:https';

import type { FluxionContext, FluxionModuleContext, FluxionRequest } from '../types.js';
import {
  HttpCode,
  HANDLER_TIMEOUT_FLAG,
  META_PREFIX,
  STATIC_HANDLED_FLAG,
  FluxionModuleType,
  MIDDLEWARE_TIMEOUT_FLAG,
} from '@/common/consts.js';
import { PromiseTry } from '@/common/promise-try.js';
import { getErrorMessage } from '@/common/logger.js';

import { getRealIp } from './headers.js';
import { toURL } from './request.js';
import { safeSendJson } from './respond.js';
import { parseBody, type BodyPreview } from './body.js';
import { parseQuery } from './query.js';
import { parseCookie } from './cookie.js';
import { HttpException } from './exceptions.js';

const waiter = (mainPromise: Promise<any>, timeoutMs: number, flag: symbol) =>
  Promise.race([mainPromise, new Promise((r) => setTimeout(() => r(flag), timeoutMs))]);

export function createServer(cx: FluxionContext): Promise<http.Server | https.Server> {
  const moduleCx: FluxionModuleContext = Object.freeze({ logger: cx.logger });

  const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const method = req.method ?? 'GET';
    const ip = getRealIp(req);
    const url = toURL(req.url);
    if (url === undefined) {
      safeSendJson(res, { message: 'Bad Request: req.url is undefined' }, HttpCode.BadRequest);
      return;
    }

    const normalized: FluxionRequest = {
      method,
      ip,
      url,
      query: parseQuery(url.searchParams),
      body: {},
      headers: req.headers,
      cookie: parseCookie(req.headers.cookie as string | undefined),
      meta: {},
    };

    let bodyPreview: BodyPreview = {
      exists: false,
      bytes: 0,
      truncated: false,
    };

    cx.logger.core({ message: 'request', method, ip, path: url.pathname });

    const start = performance.now();
    res.once('finish', () => {
      const o: Record<string, unknown> = {
        message: 'response',
        method,
        ip,
        path: url.pathname,
        status: res.statusCode,
        duration: (performance.now() - start).toFixed(4),
      };

      if (Object.keys(normalized.query).length > 0) {
        o.query = normalized.query;
      }

      if (bodyPreview.exists) {
        o.body = bodyPreview.value;
        o.bodyBytes = bodyPreview.bytes;
        o.bodyTruncated = bodyPreview.truncated;
      }

      cx.logger.core(o);
    });

    // * Start request handling
    try {
      // Handle meta API requests
      if (normalized.url.pathname.startsWith(META_PREFIX + '/')) {
        await handleMetaApi(cx, url, method, res);
        return;
      }

      const parsed = await parseBody(req, normalized.method, cx.options.maxRequestBytes);
      normalized.body = parsed.body;
      bodyPreview = parsed.preview;

      const m = await cx.router.getModule(url);
      if (!m) {
        safeSendJson(res, { message: 'Not Found' }, HttpCode.NotFound);
        return;
      }

      if (req.method && m.methods && !m.methods.includes(req.method)) {
        safeSendJson(res, { message: 'Method Not Allowed' }, HttpCode.MethodNotAllowed);
        return;
      }

      const timeoutMs =
        m.type === FluxionModuleType.Api
          ? (m.handlerTimeoutMs ?? cx.options.handlerTimeoutMs)
          : cx.options.staticResourceTimeoutMs;

      // Middleware execution
      if (m.middlewares) {
        for (let i = 0; i < m.middlewares.length; i++) {
          const result = await waiter(
            PromiseTry(m.middlewares[i], normalized, moduleCx, req, res),
            cx.options.middlewareTimeoutMs,
            MIDDLEWARE_TIMEOUT_FLAG,
          );

          if (result === MIDDLEWARE_TIMEOUT_FLAG) {
            cx.logger.warn({
              message: 'MiddlewareTimeout',
              method: normalized.method,
              ip: normalized.ip,
            });
            safeSendJson(res, { message: 'Internal Server Error' }, HttpCode.InternalServerError);
            return;
          }
          if (res.writableEnded) {
            return;
          }
          if (res.headersSent) {
            res.end();
            return;
          }
        }
      }

      const result = await waiter(
        PromiseTry(m.handler, normalized, moduleCx, req, res),
        timeoutMs,
        HANDLER_TIMEOUT_FLAG,
      );

      if (result === HANDLER_TIMEOUT_FLAG) {
        cx.logger.warn({ message: 'HandlerTimeout', method: normalized.method, ip: normalized.ip });
        safeSendJson(res, { message: 'Handler timed out' }, HttpCode.InternalServerError);
        return;
      }

      if (result !== STATIC_HANDLED_FLAG) {
        safeSendJson(res, result);
      }
    } catch (e) {
      if (e instanceof HttpException) {
        cx.logger.error({
          message: 'RequestFailed',
          method: normalized.method,
          ip: normalized.ip,
          path: normalized.url.pathname,
          error: e.message,
        });
        safeSendJson(res, { message: e.message }, e.errno);
      } else {
        cx.logger.error({
          message: 'RequestFailed',
          method: normalized.method,
          ip: normalized.ip,
          path: normalized.url.pathname,
          error: getErrorMessage(e),
        });
        safeSendJson(
          res,
          { message: getErrorMessage(e) },
          (e as NodeJS.ErrnoException).errno ?? HttpCode.InternalServerError,
        );
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

  return new Promise((resolve, reject) => {
    let listening = false;

    server.on('close', () => {
      cx.logger.core({
        message: 'ServerClosed',
        host: cx.options.host,
        port: cx.options.port,
      });
    });

    server.once('listening', () => {
      listening = true;
      cx.logger.core({
        message: 'FluxionStarted',
        version: '__VERSION__',
        pid: process.pid,
        protocol: cx.options.https ? 'https' : 'http',
        host: cx.options.host,
        port: cx.options.port,
      });
      cx.logger.core({
        message: 'DynamicDirectory',
        directory: cx.options.dir,
      });
      resolve(server);
    });

    server.on('error', (error) => {
      cx.logger.error({
        message: 'ServerError',
        error: getErrorMessage(error),
      });
      if (listening) {
        process.exit(1);
      }
      reject(error);
    });

    server.listen(cx.options.port, cx.options.host);
  });
}

/**
 * Handle meta API requests
 */
async function handleMetaApi(cx: FluxionContext, url: URL, method: string, res: http.ServerResponse): Promise<void> {
  const pathname = url.pathname;

  if (method !== 'GET') {
    safeSendJson(res, { message: 'Method Not Allowed' }, HttpCode.MethodNotAllowed);
    return;
  }

  // Health check endpoint
  if (pathname === META_PREFIX + '/healthz' && cx.options.metaApis.includes('healthz')) {
    safeSendJson(res, {
      ok: true,
      pid: process.pid,
      now: Date.now(),
      uptimeSeconds: Number(process.uptime().toFixed(3)),
    });
    return;
  }

  // Version endpoint
  if (pathname === META_PREFIX + '/version' && cx.options.metaApis.includes('version')) {
    safeSendJson(res, {
      ok: true,
      version: '__VERSION__',
    });
    return;
  }

  // Routes endpoint
  if (pathname === META_PREFIX + '/routes' && cx.options.metaApis.includes('routes')) {
    if (!cx.options.metaSecret) {
      safeSendJson(res, { message: 'Not Found' }, HttpCode.NotFound);
      return;
    }

    if (url.searchParams.get('secret') !== cx.options.metaSecret) {
      safeSendJson(res, { message: 'Forbidden' }, HttpCode.Forbidden);
      return;
    }

    const routes = cx.router.getRoutes();
    safeSendJson(res, { ok: true, now: Date.now(), routes });
    return;
  }

  safeSendJson(res, { message: 'Not Found' }, HttpCode.NotFound);
}
