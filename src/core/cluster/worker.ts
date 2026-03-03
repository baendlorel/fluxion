import cluster from 'node:cluster';

import type { PrimaryMessage } from './types.js';
import { WorkerAction, PrimaryAction, isPrimaryMessage } from './consts.js';
import { sendToPrimary } from './communicate.js';
import { createWorkerServer } from './server.js';

export async function createWorker() {
  if (cluster.isPrimary) {
    $throw('createWorker should only be called in worker process');
  }

  const rawInjections = fluxion.injections.map(async (v) => ({ name: v.name, instance: await v.factory() }));
  const injections = await Promise.all(rawInjections);
  injections.forEach((v) => Reflect.set(globalThis, v.name, v.instance));

  // Send this to get fluxion options from primary process, and then start the server
  sendToPrimary({ type: WorkerAction.Created, pid: process.pid });

  process.on('message', (raw: PrimaryMessage) => {
    if (!isPrimaryMessage(raw)) {
      return;
    }

    if (raw.type === PrimaryAction.SendFluxionOptions) {
      Reflect.set(globalThis, 'fluxion', raw.options);
      Reflect.set(globalThis, 'logger', raw.options.logger);
      logger.info(`[worker ${process.pid}] received message`, raw);
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
