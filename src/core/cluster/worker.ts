import cluster from 'node:cluster';
import type { NormalizedFluxionOptions } from '../types.js';
import type { PrimaryMessage } from './types.js';

import { initializeGlobalState, logger } from './global-state.js';
import { WorkerAction, PrimaryAction, isPrimaryMessage, INJECTION_KEY } from './consts.js';
import { sendToPrimary } from './communicate.js';
import { createWorkerServer } from './server.js';

const inject = async (options: NormalizedFluxionOptions) => {
  const o = {} as any;
  Reflect.set(globalThis, INJECTION_KEY, o);
  for (let i = 0; i < options.injections.length; i++) {
    const { name, modulePath } = options.injections[i];
    const factory = await import(modulePath).then((m) => m.default);
    const instance = await Promise.try(factory);
    o[name] = instance;
  }
};

export async function createWorker() {
  if (cluster.isPrimary) {
    $throw('createWorker should only be called in worker process');
  }

  // Send this to get fluxion options from primary process, and then start the server
  sendToPrimary({ type: WorkerAction.Created, pid: process.pid });

  process.on('message', (raw: PrimaryMessage) => {
    if (!isPrimaryMessage(raw)) {
      return;
    }

    if (raw.type === PrimaryAction.SendFluxionOptions) {
      // fixme function 的logger可能无法正确传输，要另想办法
      logger.info(`[worker ${process.pid}] received SendFluxionOptions`, raw);
      initializeGlobalState(raw.options);
      inject(raw.options);
      createWorkerServer(raw.options);
      sendToPrimary({ type: WorkerAction.Ready, pid: process.pid });
      return;
    }

    if (raw.type === PrimaryAction.Ping) {
      sendToPrimary({ type: WorkerAction.Pong, pid: process.pid, sentAt: raw.sentAt, receivedAt: Date.now() });
      return;
    }
  });
}
