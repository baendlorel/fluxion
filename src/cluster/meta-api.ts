import http from 'node:http';

import { getErrorMessage } from '@/common/logger.js';
import { HttpCode, META_PREFIX } from '@/common/consts.js';
import { sendJson } from '../http/respond.js';
import { FluxionContext } from '../types.js';

export function createPrimaryMetaApiServer(
  cx: Pick<FluxionContext, 'logger' | 'options' | 'router'>,
  getWorkersSnapshot: () => unknown,
): http.Server {
  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';

    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://fluxion.local').pathname;
    } catch {
      sendJson(res, { message: 'Bad Request: invalid url' }, HttpCode.BadRequest);
      return;
    }

    if (method === 'GET' && pathname === META_PREFIX + '/healthz') {
      sendJson(res, {
        ok: true,
        role: 'primary',
        pid: process.pid,
        now: Date.now(),
        uptimeSeconds: Number(process.uptime().toFixed(3)),
      });
      return;
    }

    if (method === 'GET' && pathname === META_PREFIX + '/workers') {
      sendJson(res, {
        ok: true,
        now: Date.now(),
        workers: getWorkersSnapshot(),
      });
      return;
    }

    sendJson(res, { message: 'Not Found' }, HttpCode.NotFound);
  });

  server.on('listening', () => {
    cx.logger.info('MetaApiStarted', {
      pid: process.pid,
      host: cx.options.host,
      port: cx.options.metaPort,
      prefix: META_PREFIX,
    });
  });

  server.on('error', (error) => {
    cx.logger.error('MetaApiError', {
      host: cx.options.host,
      port: cx.options.metaPort,
      error: getErrorMessage(error),
    });
    process.exit(1);
  });

  server.listen(cx.options.metaPort, cx.options.host);
  return server;
}
