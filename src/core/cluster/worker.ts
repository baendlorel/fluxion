import path from 'node:path';
import cluster from 'node:cluster';
import type { PrimaryMessage } from './types.js';

import { getErrorMessage } from '@/common/logger.js';
import { logger, fluxionOptions } from './global-state.js';
import { WorkerAction, PrimaryAction, isPrimaryMessage, INJECTION_KEY } from './consts.js';
import { sendToPrimary } from './communicate.js';
import { createWorkerServer } from './server.js';

const inject = async () => {
  const o = {} as any;
  Reflect.set(globalThis, INJECTION_KEY, o);
  for (let i = 0; i < fluxionOptions.injections.length; i++) {
    const { name, modulePath } = fluxionOptions.injections[i];
    const factory = await import(path.join(fluxionOptions.moduleDir, modulePath)).then((m) => m.default);
    const instance = await Promise.try(factory);
    o[name] = instance;
  }
  logger.info(`[worker ${process.pid}] injections loaded`, Object.keys(o));
};

const startStatsReporter = () => {
  let previousCpuUsage = process.cpuUsage();
  let previousAt = Date.now();

  const interval = setInterval(() => {
    const now = Date.now();
    const elapsedMicros = Math.max(1, (now - previousAt) * 1000);
    const cpuDelta = process.cpuUsage(previousCpuUsage);
    const cpuPercent = Number((((cpuDelta.user + cpuDelta.system) / elapsedMicros) * 100).toFixed(2));

    previousCpuUsage = process.cpuUsage();
    previousAt = now;

    const memoryUsage = process.memoryUsage();
    sendToPrimary({
      type: WorkerAction.Stats,
      pid: process.pid,
      stats: {
        at: now,
        pid: process.pid,
        uptimeSeconds: Number(process.uptime().toFixed(3)),
        cpu: {
          userMicros: cpuDelta.user,
          systemMicros: cpuDelta.system,
          percent: cpuPercent,
        },
        memory: {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external,
          arrayBuffers: memoryUsage.arrayBuffers,
        },
      },
    });
  }, 2000);

  interval.unref();
};

export function initWorker() {
  if (cluster.isPrimary) {
    $throw('createWorker should only be called in worker process');
  }

  process.on('message', (raw: PrimaryMessage) => {
    if (!isPrimaryMessage(raw)) {
      return;
    }

    if (raw.type === PrimaryAction.Ping) {
      sendToPrimary({ type: WorkerAction.Pong, pid: process.pid, sentAt: raw.sentAt, receivedAt: Date.now() });
      return;
    }
  });

  sendToPrimary({ type: WorkerAction.Created, pid: process.pid });
  startStatsReporter();

  Promise.try(async () => {
    await inject();
    createWorkerServer();
    sendToPrimary({ type: WorkerAction.Ready, pid: process.pid });
  }).catch((error) => {
    logger.error('WorkerBootstrapFailed', {
      pid: process.pid,
      error: getErrorMessage(error),
    });
    process.exit(1);
  });
}
