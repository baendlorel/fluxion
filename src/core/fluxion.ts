import http from 'node:http';
import type { FluxionOptions } from './types.js';

import { createLogger } from '@/common/logger.js';
import { normalizeOptions } from './utils/options.js';
import { initializeGlobalState } from './cluster/global-state.js';
import cluster from 'node:cluster';
import { initPrimary } from './cluster/primary.js';
import { initWorker } from './cluster/worker.js';

export async function fluxion(options: FluxionOptions) {
  const normalized = normalizeOptions(options);

  const logger = await createLogger(normalized.logger);
  initializeGlobalState(normalized, logger);

  if (cluster.isPrimary) {
    initPrimary();
  } else {
    initWorker();
  }
}
