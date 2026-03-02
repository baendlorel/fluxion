import { fluxion, type FluxionOptions } from './core/server.js';

export { fluxion, type FluxionOptions };

if (process.env.NODE_ENV !== 'production') {
  fluxion({
    dir: process.env.DYNAMIC_DIRECTORY ?? 'dynamicDirectory',
    host: process.env.HOST ?? 'localhost',
    port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000,
  });
}
