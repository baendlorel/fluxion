import { fluxion } from '../src/fluxion.js';

fluxion({
  dir: process.env.DYNAMIC_DIRECTORY ?? 'hotapis',
  host: process.env.HOST ?? 'localhost',
  port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000,
});
