import http from 'node:http';

import { getErrorMessage } from '@/common/logger.js';

import type { FluxionOptions } from './types.js';
import { createMetaApiHandler } from './meta-api.js';
import { normalizeOptions } from './utils/options.js';
import { createFluxionServer } from './server.js';

export function fluxion(options: FluxionOptions): http.Server {
  const normalized = normalizeOptions(options);

  const dir = normalized.dir;
  // todo 这里的logger要另外创建？
  const logger = normalized.logger;

  const server = createFluxionServer({
    ...normalized,
    handler: createMetaApiHandler(),
  });

  server.on('close', () => {
    logger.info('ServerClosed', {
      host: normalized.host,
      port: normalized.port,
    });
  });

  server.listen(normalized.port, normalized.host, () => {
    logger.info('ServerStarted', {
      host: normalized.host,
      port: normalized.port,
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
