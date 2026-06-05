import type { FluxionHandler, FluxionOptions } from './core/types.js';
import { fluxion } from './core/fluxion.js';

export { fluxion, type FluxionOptions as FluxionOptions };

export function defineFluxionHandler(handler: FluxionHandler) {
  return handler;
}

if (process.env.NODE_ENV !== 'production') {
  globalThis.$throw = (message: string) => {
    throw new Error('[fluxion error]' + message);
  };

  fluxion({
    dir: process.env.DYNAMIC_DIRECTORY ?? 'dynamicDirectory',
    host: process.env.HOST ?? 'localhost',
    port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000,
    reloadDelay: process.env.RELOAD_DELAY ? Number.parseInt(process.env.RELOAD_DELAY, 10) : undefined,
    workerOptions: {
      maxWorkerCount: 1,
    },
  });
}
