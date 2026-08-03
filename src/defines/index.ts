import type {
  FluxionHandler,
  FluxionDisposer,
  FluxionModuleWithType,
  FluxionModule,
  FluxionMiddleware,
} from '@/types.js';
import type { FluxionLoggerFn } from '@/common/logger.js';
import { FluxionModuleType } from '@/common/consts.js';

export { defineFluxionOptions } from './options.js';

/**
 * Use handler function and optional disposer function to define a Fluxion module.
 * @param handler Main function that handles request and response instances
 * @param disposer Deal with resource cleanup when the server is about to close
 */
export function defineFluxionModule(handler: FluxionHandler, disposer?: FluxionDisposer): FluxionModuleWithType;
/**
 * Provides type safety for defining Fluxion modules.
 */
export function defineFluxionModule(fluxionModule: FluxionModule): FluxionModuleWithType;
export function defineFluxionModule(
  a: FluxionModule | FluxionHandler,
  disposer?: FluxionDisposer,
): FluxionModuleWithType {
  if (typeof a === 'function') {
    if (disposer !== undefined && typeof disposer !== 'function') {
      _throw(`Invalid disposer, expected a function but got ${typeof disposer}`);
    }
    return { handler: a, disposer, type: FluxionModuleType.Api };
  }

  if (typeof a !== 'object' || a === null) {
    _throw(`Invalid argument, expected a FluxionModule object or a handler function, but got ${typeof a}`);
  }

  if (typeof a.handler !== 'function') {
    _throw(`Invalid FluxionModule, "handler" must be a function`);
  }

  if (a.disposer !== undefined && typeof a.disposer !== 'function') {
    _throw(`Invalid FluxionModule, "disposer" must be a function if provided`);
  }

  if (a.methods !== undefined && (!Array.isArray(a.methods) || a.methods.some((v) => typeof v !== 'string'))) {
    _throw(`Invalid FluxionModule, "methods" must be an array of strings if provided`);
  }

  if (
    a.middlewares !== undefined &&
    (!Array.isArray(a.middlewares) || a.middlewares.some((v) => typeof v !== 'function'))
  ) {
    _throw(`Invalid FluxionModule, "middlewares" must be an array of functions if provided`);
  }

  return { ...a, type: FluxionModuleType.Api };
}

export function defineFluxionMiddleware(middleware: FluxionMiddleware): FluxionMiddleware {
  if (typeof middleware !== 'function') {
    _throw(`Invalid FluxionMiddleware, expected a function but got ${typeof middleware}`);
  }
  return middleware;
}

export function defineFluxionLogger(loggerFn: FluxionLoggerFn) {
  if (typeof loggerFn !== 'function') {
    _throw(`Invalid FluxionLoggerFn, expected a function but got ${typeof loggerFn}`);
  }
  return loggerFn;
}
