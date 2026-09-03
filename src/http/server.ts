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

    // Security headers for all responses
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Restrict resource loading to same-origin by default
    res.setHeader('Content-Security-Policy', "default-src 'self'");

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

      const m = await cx.router.get(url);
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
          ...normalized,
          message: 'RequestFailed',
          error: e.message,
        });
        safeSendJson(res, { message: e.message }, e.errno);
      } else {
        cx.logger.error({
          ...normalized,
          message: 'RequestFailed',
          error: getErrorMessage(e),
        });
        safeSendJson(res, { message: 'Internal Server Error' }, HttpCode.InternalServerError);
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

    server.on('error', (e) => {
      cx.logger.error({
        message: 'ServerError',
        error: getErrorMessage(e),
      });
      if (listening) {
        // Server encountered an error after binding — log and let the
        // caller (PM2 / user code) decide how to recover instead of
        // forcing process.exit(1) here.
        return;
      }
      reject(e);
    });

    server.listen(cx.options.port, cx.options.host);
  });
}

/**
 * Validate meta API secret from request
 */
function validateMetaSecret(url: URL, metaSecret: string | undefined): boolean {
  if (!metaSecret) {
    return false;
  }
  const providedSecret = url.searchParams.get('secret');
  return providedSecret === metaSecret;
}

/**
 * Check if endpoint requires authentication
 */
function requiresAuth(endpoint: string): boolean {
  const protectedEndpoints = ['config'];
  return protectedEndpoints.includes(endpoint);
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

  const endpointName = pathname.replace(META_PREFIX + '/', '');

  // Check authentication for protected endpoints
  if (requiresAuth(endpointName)) {
    if (!validateMetaSecret(url, cx.options.metaSecret)) {
      safeSendJson(res, { message: 'Unauthorized' }, HttpCode.Unauthorized);
      return;
    }
  }

  if (pathname === META_PREFIX + '/healthz' && cx.options.metaApis.includes('healthz')) {
    safeSendJson(res, {
      ok: true,
      now: Date.now(),
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      version: '__VERSION__',
    });
    return;
  }

  if (pathname === META_PREFIX + '/stats' && cx.options.metaApis.includes('stats')) {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();

    safeSendJson(res, {
      ok: true,
      now: Date.now(),
      pid: process.pid,
      uptime: {
        seconds: Number(uptime.toFixed(3)),
        human: formatUptime(uptime),
      },
      memory: {
        rss: {
          value: memoryUsage.rss,
          mb: Number((memoryUsage.rss / 1024 / 1024).toFixed(2)),
          description: 'Resident Set Size - total memory allocated',
        },
        heapTotal: {
          value: memoryUsage.heapTotal,
          mb: Number((memoryUsage.heapTotal / 1024 / 1024).toFixed(2)),
          description: 'Total heap memory allocated',
        },
        heapUsed: {
          value: memoryUsage.heapUsed,
          mb: Number((memoryUsage.heapUsed / 1024 / 1024).toFixed(2)),
          description: 'Heap memory currently in use',
        },
        external: {
          value: memoryUsage.external,
          mb: Number((memoryUsage.external / 1024 / 1024).toFixed(2)),
          description: 'External memory (C++ objects, etc.)',
        },
        arrayBuffers: {
          value: memoryUsage.arrayBuffers,
          mb: Number((memoryUsage.arrayBuffers / 1024 / 1024).toFixed(2)),
          description: 'Memory allocated for ArrayBuffers and SharedArrayBuffers',
        },
      },
      cpu: {
        user: Math.round(cpuUsage.user / 1000), // Convert microseconds to milliseconds
        system: Math.round(cpuUsage.system / 1000),
        description: 'CPU time used since start (milliseconds)',
      },
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        execPath: process.execPath,
      },
    });
    return;
  }

  if (pathname === META_PREFIX + '/config' && cx.options.metaApis.includes('config')) {
    const safeConfig = {
      dir: cx.options.dir,
      host: cx.options.host,
      port: cx.options.port,
      handlerTimeoutMs: cx.options.handlerTimeoutMs,
      middlewareTimeoutMs: cx.options.middlewareTimeoutMs,
      staticResourceTimeoutMs: cx.options.staticResourceTimeoutMs,
      moduleDir: cx.options.moduleDir,
      maxRequestBytes: cx.options.maxRequestBytes,
      apiInclude: cx.options.apiInclude,
      staticInclude: cx.options.staticInclude,
      exclude: cx.options.exclude,
      metaApis: cx.options.metaApis,
      metaSecretSet: cx.options.metaSecret !== undefined,
      httpsEnabled: cx.options.https !== undefined,
    };

    safeSendJson(res, {
      ok: true,
      now: Date.now(),
      config: safeConfig,
    });
    return;
  }

  safeSendJson(res, { message: 'Not Found' }, HttpCode.NotFound);
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (secs > 0 || parts.length === 0) {
    parts.push(`${secs}s`);
  }

  return parts.join(' ');
}
