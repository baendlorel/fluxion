import type { FluxionLogger } from '@/common/logger.js';
import { NormalizedFluxionOptions } from '../types.js';

export let logger: FluxionLogger = null as any;
export let fluxionOptions: NormalizedFluxionOptions = null as any;

export const initializeGlobalState = (_options: NormalizedFluxionOptions, _logger: FluxionLogger) => {
  fluxionOptions = _options;
  logger = _logger;
};
