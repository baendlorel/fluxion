import http from 'node:http';

import type { FluxionLogger } from '@/common/logger.js';
import { getErrorMessage } from '@/common/logger.js';
import { HttpCode, META_PREFIX } from '@/common/consts.js';
import { sendJson } from '../utils/respond.js';

export interface PrimaryMetaApiOptions {
  host: string;
  port: number;
  logger: FluxionLogger;
  getWorkersSnapshot: () => unknown;
}

export function createPrimaryMetaApiServer(options: PrimaryMetaApiOptions): http.Server {
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
        workers: options.getWorkersSnapshot(),
      });
      return;
    }

    sendJson(res, { message: 'Not Found' }, HttpCode.NotFound);
  });

  server.on('listening', () => {
    options.logger.info('MetaApiStarted', {
      pid: process.pid,
      host: options.host,
      port: options.port,
      prefix: META_PREFIX,
    });
  });

  server.on('error', (error) => {
    options.logger.error('MetaApiError', {
      host: options.host,
      port: options.port,
      error: getErrorMessage(error),
    });
    process.exit(1);
  });

  server.listen(options.port, options.host);
  return server;
}
