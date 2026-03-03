import http from 'node:http';

import { getErrorMessage } from '@/common/logger.js';

import type { FluxionOptions } from './types.js';
import { createMetaApiHandler } from './meta-api.js';
import { normalizeOptions } from './utils/options.js';
import { createFluxionServer } from './server.js';

export function fluxion(options: FluxionOptions): http.Server;
export function fluxion(rawOptions: FluxionOptions): http.Server {
  const options = normalizeOptions(rawOptions);

  const dir = options.dir;
  const logger = options.logger;

  const server = createFluxionServer({
    ...options,
    handler: createMetaApiHandler(),
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
