import type { FluxionOptions } from './types.js';

import { createLogger } from '@/common/logger.js';
import { normalizeOptions } from './utils/options.js';
import { initializeGlobalState } from './cluster/global-state.js';
import cluster from 'node:cluster';
import { initPrimary } from './cluster/primary.js';
import { initWorker } from './cluster/worker.js';
import { FluxionWatcher } from './watch.js';

export async function fluxion(options: FluxionOptions) {
  const normalized = normalizeOptions(options);

  const logger = await createLogger(normalized.logger);
  initializeGlobalState(normalized, logger);

  new FluxionWatcher({ dir: normalized.dir, delay: normalized.reloadDelay, logger, refresh: () => {} }).start();

  if (cluster.isPrimary) {
    initPrimary();
  } else {
    initWorker();
  }
}
