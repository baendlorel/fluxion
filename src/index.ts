import type { FluxionDispose, FluxionHandler, FluxionModule, FluxionModuleWithType } from './types.js';
import { fluxion } from './fluxion.js';
import { FluxionModuleType, noop } from './common/consts.js';

export { fluxion };
export type { FluxionDispose, FluxionHandler, FluxionModule as FluxionHandlerModule, FluxionOptions } from './types.js';

/**
 * Use handler function and optional disposer function to define a Fluxion module.
 * @param handler Main function that handles request and response instances
 * @param disposer Deal with resource cleanup when the server is about to close
 */
export function defineFluxionModule(handler: FluxionHandler, disposer?: FluxionDispose): FluxionModuleWithType;
/**
 * Provides type safety for defining Fluxion modules.
 */
export function defineFluxionModule(fluxionModule: FluxionModule): FluxionModuleWithType;
export function defineFluxionModule(
  a: FluxionModule | FluxionHandler,
  disposer: FluxionDispose = noop,
): FluxionModuleWithType {
  if (typeof a === 'function') {
    if (typeof disposer !== 'function') {
      $throw(`Invalid disposer, expected a function but got ${typeof disposer}`);
    }
    return { handler: a, disposer, type: FluxionModuleType.Api };
  }

  if (typeof a !== 'object' || a === null) {
    $throw(`Invalid argument, expected a FluxionModule object or a handler function, but got ${typeof a}`);
  }

  if (typeof a.handler !== 'function') {
    $throw(`Invalid FluxionModule, "handler" must be a function`);
  }

  if (a.disposer !== undefined && typeof a.disposer !== 'function') {
    $throw(`Invalid FluxionModule, "disposer" must be a function if provided`);
  }

  if (a.methods !== undefined && (!Array.isArray(a.methods) || a.methods.some((v) => typeof v !== 'string'))) {
    $throw(`Invalid FluxionModule, "methods" must be an array of strings if provided`);
  }

  if (
    a.middlewares !== undefined &&
    (!Array.isArray(a.middlewares) || a.middlewares.some((v) => typeof v !== 'function'))
  ) {
    $throw(`Invalid FluxionModule, "middlewares" must be an array of functions if provided`);
  }

  return { ...a, type: FluxionModuleType.Api };
}

if (process.env.NODE_ENV !== 'production') {
  globalThis.$throw = (message: string) => {
    throw new Error('[fluxion error]' + message);
  };

  const int = (n: string | undefined, defaultValue: number): number => {
    if (n === undefined) {
      return defaultValue;
    }
    const parsed = Number.parseInt(n, 10);
    if (Number.isNaN(parsed)) {
      return defaultValue;
    }
    return parsed;
  };

  fluxion({
    dir: process.env.DYNAMIC_DIRECTORY ?? 'dynamicDirectory',
    host: process.env.HOST ?? 'localhost',
    port: int(process.env.PORT, 9000),
    metaPort: int(process.env.META_PORT, 9001),
    reloadDelay: process.env.RELOAD_DELAY ? Number.parseInt(process.env.RELOAD_DELAY, 10) : undefined,
    workerOptions: {
      maxWorkerCount: 4,
    },
  });
}
