import { startServer } from './core/server.js';

startServer({
  dynamicDirectory: 'dynamicDirectory',
  host: process.env.HOST ?? 'localhost',
  port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
});
