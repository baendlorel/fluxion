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
import { createFluxionServer } from './create-server.js';

export function fluxion(options: FluxionOptions): http.Server;
export function fluxion(rawOptions: FluxionOptions): http.Server {
  const options = normalizeOptions(rawOptions);

  const dir = options.dir;
  const logger = options.logger;

  const metaApiHandler = createMetaApi(options);

  const server = createFluxionServer({
    ...options,
    handler: (req, res, normalized) =>
      metaApiHandler(req, res, normalized).catch((error) => {
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
      }),
  });

  server.on('close', () => {
    // todo 也许有用 void fileRuntime.close();
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
