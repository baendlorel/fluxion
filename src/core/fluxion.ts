import type { FluxionContext, FluxionOptions } from './types.js';

import { createLogger } from '@/common/logger.js';
import { normalizeOptions } from './utils/options.js';
import cluster from 'node:cluster';
import { initPrimary } from './cluster/primary.js';
import { initWorker } from './cluster/worker.js';
import { FluxionWatcher } from './watch.js';
import { FluxionRouter } from './router.js';

export async function fluxion(options: FluxionOptions) {
  const context: FluxionContext = {
    options: normalizeOptions(options),
  } as FluxionContext;

  context.logger = createLogger(context as Pick<FluxionContext, 'options'>);
  context.router = new FluxionRouter(context as Pick<FluxionContext, 'options' | 'logger'>);
  context.watcher = new FluxionWatcher(context as Pick<FluxionContext, 'options' | 'logger' | 'router'>).start();

  if (cluster.isPrimary) {
    initPrimary(context);
  } else {
    initWorker(context);
  }
}
