import type { FluxionContext, FluxionOptions, NormalizedFluxionOptions } from './types.js';

import { createLogger } from './common/logger.js';
import { OPTIONS_NORMALIZED_FLAG } from './common/consts.js';
import { defineFluxionOptions } from './defines/options.js';
import { createServer } from './http/server.js';
import { FluxionRouter } from './router/index.js';

export async function fluxion(options: FluxionOptions | NormalizedFluxionOptions) {
  const alreadyNormalized = (options as NormalizedFluxionOptions).normalizedFlag === OPTIONS_NORMALIZED_FLAG;
  const context = { options: alreadyNormalized ? options : defineFluxionOptions(options) } as FluxionContext;

  context.logger = createLogger(context as Pick<FluxionContext, 'options'>);
  context.router = new FluxionRouter(context as Pick<FluxionContext, 'options' | 'logger'>);

  // Start HTTP server
  const server = await createServer(context);

  // Register signal handlers for graceful shutdown
  const shutdown = (signal: NodeJS.Signals) => {
    context.logger.warn({ message: 'ShuttingDown', pid: process.pid, signal });
    server.close(() => process.exit(0));
    setTimeout(() => {
      context.logger.error({ message: 'ShutdownTimeout', pid: process.pid, signal });
      process.exit(1);
    }, context.options.shutdownTimeoutMs).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}
