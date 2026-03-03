import { createLogger, type FluxionLogger } from '@/common/logger.js';
import { NormalizedFluxionOptions } from '../types.js';

export let logger: FluxionLogger = createLogger('one-line');
export let fluxionOptions: NormalizedFluxionOptions = {} as any;

export const initializeGlobalState = (options: NormalizedFluxionOptions) => {
  fluxionOptions = options;
  logger = options.logger;
};
