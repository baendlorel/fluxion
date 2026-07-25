import type { FluxionContext, FluxionRouteMeta } from '../types.js';
import http from 'node:http';

import { getErrorMessage } from '@/common/logger.js';
import { HttpCode, META_PREFIX } from '@/common/consts.js';
import { sendJson } from '../http/respond.js';

export function createPrimaryMetaApiServer(
  cx: Pick<FluxionContext, 'logger' | 'options' | 'router'>,
  getWorkersSnapshot: () => unknown,
  getRoutesSnapshot: () => Promise<FluxionRouteMeta[]>,
): http.Server {
  const server = http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';

    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://fluxion.local');
    } catch {
      sendJson(res, { message: 'Bad Request: invalid url' }, HttpCode.BadRequest);
      return;
    }

    if (method === 'GET' && url.pathname === META_PREFIX + '/healthz') {
      sendJson(res, {
        ok: true,
        role: 'primary',
        pid: process.pid,
        now: Date.now(),
        uptimeSeconds: Number(process.uptime().toFixed(3)),
      });
      return;
    }

    if (method === 'GET' && url.pathname === META_PREFIX + '/workers') {
      sendJson(res, {
        ok: true,
        now: Date.now(),
        workers: getWorkersSnapshot(),
      });
      return;
    }

    if (method === 'GET' && url.pathname === META_PREFIX + '/routes') {
      if (!cx.options.metaSecret) {
        sendJson(res, { message: 'Not Found' }, HttpCode.NotFound);
        return;
      }

      if (url.searchParams.get('secret') !== cx.options.metaSecret) {
        sendJson(res, { message: 'Forbidden' }, HttpCode.Forbidden);
        return;
      }

      const routes = await getRoutesSnapshot();
      sendJson(res, { ok: true, now: Date.now(), routes });
      return;
    }

    sendJson(res, { message: 'Not Found' }, HttpCode.NotFound);
  });

  server.on('listening', () => {
    cx.logger.core({
      message: 'MetaApiStarted',
      pid: process.pid,
      host: cx.options.host,
      port: cx.options.metaPort,
      prefix: META_PREFIX,
    });
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    cx.logger.error({
      message: 'MetaApiError',
      host: cx.options.host,
      port: cx.options.metaPort,
      code: error.code,
      error: getErrorMessage(error),
    });
    process.exit(1);
  });

  server.listen(cx.options.metaPort, cx.options.host);
  return server;
}
