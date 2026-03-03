import type { NormalizedFluxionOptions } from './core/types.js';
import type { FluxionLogger } from './common/logger.ts';

export type otherstring = string & {};

declare global {
  function $throw(message: string): never;
  const fluxion: NormalizedFluxionOptions;
  const logger: FluxionLogger;
}
