import { fluxion } from './core/fluxion.js';
import { FluxionOptions } from './core/types.js';

export { fluxion, type FluxionOptions as FluxionOptions };

if (typeof globalThis.$throw !== 'function') {
  globalThis.$throw = (message: string) => {
    throw new Error('[fluxion error]' + message);
  };
}

if (process.env.NODE_ENV !== 'production') {
  fluxion({
    dir: process.env.DYNAMIC_DIRECTORY ?? 'dynamicDirectory',
    host: process.env.HOST ?? 'localhost',
    port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000,
  });
}
