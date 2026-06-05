import type { PrimaryMessage } from './types.js';
import type { FluxionContext } from '../types.js';
import cluster from 'node:cluster';

import { getErrorMessage } from '@/common/logger.js';
import { loadFunction } from '@/common/injector.js';
import { PromiseTry } from '@/common/promise-try.js';
import { WorkerAction, PrimaryAction, isPrimaryMessage, INJECTION_KEY } from './consts.js';
import { sendToPrimary } from './communicate.js';

const inject = async (cx: FluxionContext) => {
  const o = {} as any;
  Reflect.set(globalThis, INJECTION_KEY, o);
  for (let i = 0; i < cx.options.injections.length; i++) {
    const injection = cx.options.injections[i];
    const factory = loadFunction(injection);
    const instance = await PromiseTry(factory);
    o[injection.name] = instance;
  }
  cx.logger.info(`[worker ${process.pid}] injections loaded`, Object.keys(o));
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

export function initWorker(cx: FluxionContext) {
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

  PromiseTry(async () => {
    await inject(cx);
    // createWorkerServer();
    sendToPrimary({ type: WorkerAction.Ready, pid: process.pid });
  }).catch((error) => {
    cx.logger.error('WorkerBootstrapFailed', {
      pid: process.pid,
      error: getErrorMessage(error),
    });
    process.exit(1);
  });
}
