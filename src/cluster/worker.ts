import type { PrimaryMessage } from './types.js';
import type { FluxionContext } from '../types.js';
import type http from 'node:http';
import type https from 'node:https';
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

    if (raw.type === PrimaryAction.Routes) {
      sendToPrimary({
        type: WorkerAction.Routes,
        pid: process.pid,
        requestId: raw.requestId,
        routes: cx.router.getRoutes(),
      });
    }
  });

  sendToPrimary({ type: WorkerAction.Created, pid: process.pid });
  startStatsReporter();

  // # Start creation
  let server: http.Server | https.Server | undefined;
  let exiting = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (exiting) {
      return;
    }
    exiting = true;
    cx.logger.warn({ message: 'WorkerShuttingDown', pid: process.pid, signal });
    cx.watcher.stop();

    if (!server) {
      process.exit(0);
    }

    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    server.close((error) => {
      if (error) {
        cx.logger.error({ message: 'WorkerShutdownFailed', pid: process.pid, error: getErrorMessage(error) });
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  createWorkerServer(cx)
    .then((s) => {
      server = s;
      sendToPrimary({ type: WorkerAction.Ready, pid: process.pid });
    })
    .catch((e) => {
      cx.logger.error({
        message: 'WorkerBootstrapFailed',
        pid: process.pid,
        error: getErrorMessage(e),
      });
      cx.watcher.stop();
      process.exit(1);
    });
}
