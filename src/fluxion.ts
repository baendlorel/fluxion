import type { FluxionContext, FluxionOptions, NormalizedFluxionOptions } from './types.js';
import cluster from 'node:cluster';

import { createLogger, createWorkerLogger } from './common/logger.js';
import { OPTIONS_NORMALIZED_FLAG } from './common/consts.js';
import { defineFluxionOptions } from './defines/options.js';
import { initPrimary } from './cluster/primary.js';
import { initWorker } from './cluster/worker.js';
import { ApiWatcher } from './watcher/api-watcher.js';
import { FluxionChokidarCore, FluxionNativeCore } from './watcher/core.js';
import { FluxionRouter } from './router/index.js';

export async function fluxion(options: FluxionOptions | NormalizedFluxionOptions) {
  const alreadyNormalized = (options as NormalizedFluxionOptions).normalizedFlag === OPTIONS_NORMALIZED_FLAG;
  const context = { options: alreadyNormalized ? options : defineFluxionOptions(options) } as FluxionContext;

  context.logger = createLogger(context as Pick<FluxionContext, 'options'>);
  context.router = new FluxionRouter(context as Pick<FluxionContext, 'options' | 'logger'>);

  if (cluster.isPrimary) {
    await initPrimary(context);
  } else {
    // Replace logger with worker logger that prefixes PID
    context.logger = createWorkerLogger(context.logger, process.pid);
    // Only worker creates the watcher
    const CoreType = context.options.nativeWatcher ? FluxionNativeCore : FluxionChokidarCore;
    context.watcher = await new ApiWatcher(
      context as Pick<FluxionContext, 'options' | 'logger' | 'router'>,
      CoreType,
    ).start();
    initWorker(context);
  }
}

if (process.env.NODE_ENV !== 'production') {
  fluxion({
    dir: process.env.DYNAMIC_DIRECTORY ?? 'dynamicDirectory',
    host: process.env.HOST ?? 'localhost',
    port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000,
  });
}
