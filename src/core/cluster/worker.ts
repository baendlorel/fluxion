import cluster from 'node:cluster';
import type { PrimaryMessage } from './types.js';

import { initializeGlobalState, logger, fluxionOptions } from './global-state.js';
import { WorkerAction, PrimaryAction, isPrimaryMessage, INJECTION_KEY } from './consts.js';
import { sendToPrimary } from './communicate.js';
import { createWorkerServer } from './server.js';
import { createLogger } from '@/common/logger.js';

const inject = async () => {
  const o = {} as any;
  Reflect.set(globalThis, INJECTION_KEY, o);
  for (let i = 0; i < fluxionOptions.injections.length; i++) {
    const { name, modulePath } = fluxionOptions.injections[i];
    const factory = await import(modulePath).then((m) => m.default);
    const instance = await Promise.try(factory);
    o[name] = instance;
  }
  logger.info(`[worker ${process.pid}] injections loaded`, Object.keys(o));
};

export async function createWorker() {
  if (cluster.isPrimary) {
    $throw('createWorker should only be called in worker process');
  }

  // Send this to get fluxion options from primary process, and then start the server
  sendToPrimary({ type: WorkerAction.Created, pid: process.pid });

  process.on('message', async (raw: PrimaryMessage) => {
    if (!isPrimaryMessage(raw)) {
      return;
    }

    if (raw.type === PrimaryAction.SendFluxionOptions) {
      const logger = await createLogger(raw.options.logger);
      logger.info(`[worker ${process.pid}] received SendFluxionOptions`, raw);
      initializeGlobalState(raw.options, logger);
      inject();
      createWorkerServer();
      sendToPrimary({ type: WorkerAction.Ready, pid: process.pid });
      return;
    }

    if (raw.type === PrimaryAction.Ping) {
      sendToPrimary({ type: WorkerAction.Pong, pid: process.pid, sentAt: raw.sentAt, receivedAt: Date.now() });
      return;
    }
  });
}
