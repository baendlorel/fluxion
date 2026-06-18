import type { PrimaryMessage } from './types.js';
import type { FluxionContext } from '../types.js';
import cluster from 'node:cluster';

import { getErrorMessage } from '@/common/logger.js';
import { WorkerAction, PrimaryAction, isPrimaryMessage } from './consts.js';
import { sendToPrimary } from './communicate.js';
import { createWorkerServer } from './server.js';

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

  try {
    createWorkerServer(cx);
    sendToPrimary({ type: WorkerAction.Ready, pid: process.pid });
  } catch (e) {
    cx.logger.error('WorkerBootstrapFailed', {
      pid: process.pid,
      error: getErrorMessage(e),
    });
    process.exit(1);
  }
}
