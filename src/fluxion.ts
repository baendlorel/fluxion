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

  if (cluster.isPrimary) {
    context.router = new FluxionRouter(context as Pick<FluxionContext, 'options' | 'logger'>);
    await initPrimary(context);
  } else if (process.env.FLUXION_WORKER_TYPE === 'cronjob') {
    // Cronjob worker: no router, no ApiWatcher
    context.logger = createWorkerLogger(context.logger, process.pid);
    initWorker(context);
  } else {
    // Regular HTTP worker
    context.router = new FluxionRouter(context as Pick<FluxionContext, 'options' | 'logger'>);
    context.logger = createWorkerLogger(context.logger, process.pid);
    const CoreType = context.options.nativeWatcher ? FluxionNativeCore : FluxionChokidarCore;
    context.watcher = await new ApiWatcher(
      context as Pick<FluxionContext, 'options' | 'logger' | 'router'>,
      CoreType,
    ).start();
    initWorker(context);
  }
}
