import http from 'node:http';
import type { FluxionOptions } from './types.js';

import { createLogger } from '@/common/logger.js';
import { normalizeOptions } from './utils/options.js';
import { initializeGlobalState } from './cluster/global-state.js';

export async function fluxion(options: FluxionOptions) {
  const normalized = normalizeOptions(options);

  const logger = await createLogger(normalized.logger);
  initializeGlobalState(normalized, logger);
}
