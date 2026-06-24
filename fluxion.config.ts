import { defineFluxionLogger, defineFluxionOptions } from './src/defines/index.js';

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

const logger = defineFluxionLogger((entry) => {
  // eslint-disable-next-line @typescript-eslint/no-console
  console.log(JSON.stringify(entry));
});

export default defineFluxionOptions({
  dir: process.env.DYNAMIC_DIRECTORY ?? 'dynamicDirectory',
  host: process.env.HOST ?? 'localhost',
  port: int(process.env.PORT, 9000),
  metaPort: int(process.env.META_PORT, 9001),
  reloadDelay: process.env.RELOAD_DELAY ? Number.parseInt(process.env.RELOAD_DELAY, 10) : undefined,
  workerOptions: {
    maxWorkerCount: 4,
  },
  logger,
});
