import { ResolvedFluxionOptions } from './core/types.js';

export type otherstring = string & {};

declare global {
  function $throw(message: string): never;
  const fluxionOptions: ResolvedFluxionOptions;
}
