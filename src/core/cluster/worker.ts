import cluster from 'node:cluster';

import type { WorkerMessage, PrimaryMessage } from './types.js';
import { WorkerAction, PrimaryAction, isPrimaryMessage } from './consts.js';
import { createFileRuntime } from './file-runtime.js';

const sendToPrimary = (message: WorkerMessage) => process.send?.(message);

export async function createWorker() {
  if (cluster.isPrimary) {
    $throw('createWorker should only be called in worker process');
  }

  // todo 第一步是要接收fluxionoptions
  const rawInjections = fluxionOptions.injections.map(async (v) => ({ name: v.name, instance: await v.factory() }));
  const injections = await Promise.all(rawInjections);
  injections.forEach((v) => Reflect.set(globalThis, v.name, v.instance));

  // todo 在这里启动url2handler的监听，收到消息后直接执行对应的handler

  createFileRuntime();

  sendToPrimary({
    type: WorkerAction.Ready,
    pid: process.pid,
  });

  process.on('message', (raw: PrimaryMessage) => {
    if (!isPrimaryMessage(raw)) {
      return;
    }

    console.log(`[worker ${process.pid}] received message`, raw);
    if (raw.type === PrimaryAction.Ping) {
      sendToPrimary({
        type: WorkerAction.Pong,
        pid: process.pid,
        sentAt: raw.sentAt,
        receivedAt: Date.now(),
      });
      return;
    }
  });
}
