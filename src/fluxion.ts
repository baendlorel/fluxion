import type { FluxionContext, FluxionOptions, NormalizedFluxionOptions } from './types.js';

import { createLogger } from './common/logger.js';
import { OPTIONS_NORMALIZED_FLAG } from './common/consts.js';
import { defineFluxionOptions } from './defines/options.js';
import { createServer } from './http/server.js';
import { ApiWatcher } from './watcher/api-watcher.js';
import { FluxionChokidarCore, FluxionNativeCore } from './watcher/core.js';
import { FluxionRouter } from './router/index.js';
import { FluxionCronJobManager } from './cronjob/manager.js';
import { CronJobWatcher } from './watcher/cronjob-watcher.js';

export async function fluxion(options: FluxionOptions | NormalizedFluxionOptions) {
  const alreadyNormalized = (options as NormalizedFluxionOptions).normalizedFlag === OPTIONS_NORMALIZED_FLAG;
  const context = { options: alreadyNormalized ? options : defineFluxionOptions(options) } as FluxionContext;

  context.logger = createLogger(context as Pick<FluxionContext, 'options'>);
  context.router = new FluxionRouter(context as Pick<FluxionContext, 'options' | 'logger'>);

  // Start API watcher for hot reload
  const CoreType = context.options.nativeWatcher ? FluxionNativeCore : FluxionChokidarCore;
  context.watcher = await new ApiWatcher(
    context as Pick<FluxionContext, 'options' | 'logger' | 'router'>,
    CoreType,
  ).start();

  // Start cronjob manager if enabled
  if (context.options.cronjobDir) {
    context.cronjobManager = new FluxionCronJobManager(context);
    const cronjobWatcher = new CronJobWatcher(
      { options: context.options, logger: context.logger, cronJobManager: context.cronjobManager },
      CoreType,
    );
    await cronjobWatcher.start();
    context.cronjobManager.start();
  }

  // Register signal handlers for graceful shutdown
  const shutdown = async (signal: NodeJS.Signals) => {
    context.logger.warn({ message: 'ShuttingDown', pid: process.pid, signal });

    // Stop watcher
    if (context.watcher) {
      context.watcher.stop();
    }

    // Stop cronjob manager
    if (context.cronjobManager) {
      context.cronjobManager.stop();
    }

    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // Start HTTP server
  await createServer(context);
}
