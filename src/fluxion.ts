import type { FluxionContext, FluxionOptions } from './types.js';

import { createLogger, createWorkerLogger } from '@/common/logger.js';
import { normalizeOptions } from './http/options.js';
import cluster from 'node:cluster';
import { initPrimary } from './cluster/primary.js';
import { initWorker } from './cluster/worker.js';
import { FluxionChokidarWatcher } from './watcher/chokidar.js';
import { FluxionNativeWatcher } from './watcher/native.js';
import { FluxionRouter } from './router/index.js';

export async function fluxion(options: FluxionOptions) {
  const context = { options: normalizeOptions(options) } as FluxionContext;

  context.logger = createLogger(context as Pick<FluxionContext, 'options'>);
  context.router = new FluxionRouter(context as Pick<FluxionContext, 'options' | 'logger'>);

  if (cluster.isPrimary) {
    initPrimary(context);
  } else {
    // Replace logger with worker logger that prefixes PID
    context.logger = createWorkerLogger(context.logger, process.pid);
    // Only worker creates the watcher
    const Watcher = context.options.nativeWatcher ? FluxionNativeWatcher : FluxionChokidarWatcher;
    context.watcher = new Watcher(context as Pick<FluxionContext, 'options' | 'logger' | 'router'>).start();
    initWorker(context);
  }
}
