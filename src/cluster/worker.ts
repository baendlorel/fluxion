import type { PrimaryMessage } from './types.js';
import type { FluxionContext } from '../types.js';
import type http from 'node:http';
import type https from 'node:https';
import cluster from 'node:cluster';

import { getErrorMessage } from '@/common/logger.js';
import { WorkerAction, PrimaryAction, isPrimaryMessage } from './consts.js';
import { sendToPrimary } from './communicate.js';
import { createWorkerServer } from './server.js';

import { FluxionCronJobManager } from '@/cronjob/manager.js';
import { CronJobWatcher } from '@/watcher/cronjob-watcher.js';
import { FluxionChokidarCore, FluxionNativeCore } from '@/watcher/core.js';

const WORKER_SHUTDOWN_TIMEOUT_MS = 10_000;
const STATS_INTERVAL_MS = 2000;
const CRONJOB_SHUTDOWN_TIMEOUT_MS = 30_000;

class FluxionWorkerRuntime {
  private server?: http.Server | https.Server;
  private statsTimer?: NodeJS.Timeout;
  private exiting = false;

  constructor(private readonly cx: FluxionContext) {}

  start(): void {
    this.registerMessageHandler();
    this.registerSignalHandlers();

    sendToPrimary({ type: WorkerAction.Created, pid: process.pid });
    this.startStatsReporter();

    createWorkerServer(this.cx)
      .then((server) => {
        this.server = server;
        sendToPrimary({ type: WorkerAction.Ready, pid: process.pid });
      })
      .catch((error) => {
        this.cx.logger.error({
          message: 'WorkerBootstrapFailed',
          pid: process.pid,
          error: getErrorMessage(error),
        });
        this.cx.watcher.stop();
        process.exit(1);
      });
  }

  private registerMessageHandler(): void {
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
          routes: this.cx.router.getRoutes(),
        });
      }
    });
  }

  private startStatsReporter(): void {
    let previousCpuUsage = process.cpuUsage();
    let previousAt = Date.now();

    this.statsTimer = setInterval(() => {
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
    }, STATS_INTERVAL_MS);

    this.statsTimer.unref();
  }

  private registerSignalHandlers(): void {
    process.once('SIGINT', () => {
      void this.shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
      void this.shutdown('SIGTERM');
    });
  }

  private stopStatsReporter(): void {
    if (!this.statsTimer) {
      return;
    }

    clearInterval(this.statsTimer);
    this.statsTimer = undefined;
  }

  private async shutdown(signal: NodeJS.Signals): Promise<void> {
    if (this.exiting) {
      return;
    }
    this.exiting = true;

    this.cx.logger.warn({ message: 'WorkerShuttingDown', pid: process.pid, signal });
    this.stopStatsReporter();
    this.cx.watcher.stop();

    if (!this.server) {
      process.exit(0);
    }

    const timer = setTimeout(() => {
      process.exit(1);
    }, WORKER_SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    this.server.close((error) => {
      clearTimeout(timer);
      if (error) {
        this.cx.logger.error({ message: 'WorkerShutdownFailed', pid: process.pid, error: getErrorMessage(error) });
        process.exit(1);
      }

      process.exit(0);
    });
  }
}

export function initWorker(cx: FluxionContext) {
  if (cluster.isPrimary) {
    $throw('createWorker should only be called in worker process');
  }

  if (process.env.FLUXION_WORKER_TYPE === 'cronjob') {
    initCronJobWorker(cx);
  } else {
    new FluxionWorkerRuntime(cx).start();
  }
}

function initCronJobWorker(cx: FluxionContext) {
  const manager = new FluxionCronJobManager(cx);
  const CoreType = cx.options.nativeWatcher ? FluxionNativeCore : FluxionChokidarCore;
  const watcher = new CronJobWatcher(
    { options: cx.options, logger: cx.logger, cronJobManager: manager },
    CoreType,
  );

  sendToPrimary({ type: WorkerAction.Created, pid: process.pid });

  watcher
    .start()
    .then(() => {
      manager.start();
      sendToPrimary({ type: WorkerAction.Ready, pid: process.pid });
    })
    .catch((error) => {
      cx.logger.error({
        message: 'CronJobWorkerBootstrapFailed',
        error: getErrorMessage(error),
      });
      process.exit(1);
    });

  let exiting = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (exiting) return;
    exiting = true;

    cx.logger.warn({ message: 'CronJobWorkerShuttingDown', signal });
    watcher.stop();
    manager.stop();

    // Wait for running jobs to complete
    const deadline = Date.now() + CRONJOB_SHUTDOWN_TIMEOUT_MS;
    while (manager.hasRunningJobs() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (manager.hasRunningJobs()) {
      cx.logger.warn({ message: 'CronJobWorkerForceExit' });
    }

    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}
