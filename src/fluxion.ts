import type { FluxionContext, FluxionOptions, NormalizedFluxionOptions } from './types.js';
import cluster from 'node:cluster';

import { createLogger, createWorkerLogger } from './common/logger.js';
import { OPTIONS_NORMALIZED_FLAG } from './common/consts.js';
import { defineFluxionOptions } from './defines/options.js';
import { initPrimary } from './cluster/primary.js';
import { initWorker } from './cluster/worker.js';
import { FluxionChokidarWatcher } from './watcher/chokidar.js';
import { FluxionNativeWatcher } from './watcher/native.js';
import { FluxionRouter } from './router/index.js';

export async function fluxion(options: FluxionOptions | NormalizedFluxionOptions) {
  const alreadyNormalized = (options as NormalizedFluxionOptions).normalizedFlag === OPTIONS_NORMALIZED_FLAG;
  const context = { options: alreadyNormalized ? options : defineFluxionOptions(options) } as FluxionContext;

  context.logger = createLogger(context as Pick<FluxionContext, 'options'>);
  context.router = new FluxionRouter(context as Pick<FluxionContext, 'options' | 'logger'>);

  if (cluster.isPrimary) {
    initPrimary(context);
  } else {
    // Replace logger with worker logger that prefixes PID
    context.logger = createWorkerLogger(context.logger, process.pid);
    // Only worker creates the watcher
    const Watcher = context.options.nativeWatcher ? FluxionNativeWatcher : FluxionChokidarWatcher;
    context.watcher = await new Watcher(context as Pick<FluxionContext, 'options' | 'logger' | 'router'>).start();
    initWorker(context);
  }
}
