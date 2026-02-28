import { fluxion } from './core/server.js';

fluxion({
  dir: process.env.DYNAMIC_DIRECTORY ?? 'dynamicDirectory',
  host: process.env.HOST ?? 'localhost',
  port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000,
});
