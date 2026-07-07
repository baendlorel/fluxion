import type { Server } from 'node:http';
import type { WorkerMessage, WorkerState, WorkerRuntimeStats } from './types.js';
import type { FluxionContext, FluxionRouteMeta } from '../types.js';
import os from 'node:os';
import cluster from 'node:cluster';
import path from 'node:path';

import { isWorkerMessage, WorkerAction, PrimaryAction } from './consts.js';
import { sendToWorker } from './communicate.js';
import { createPrimaryMetaApiServer } from './meta-api.js';
import { cleanupFluxionInstance, launchFluxionInstance } from './launcher.js';

const bytesToMb = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(2));

const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS_PER_WINDOW = 3;
const PING_INTERVAL_MS = 5000;
const ROUTES_TIMEOUT_MS = 1000;
const PRIMARY_SHUTDOWN_TIMEOUT_MS = 10_000;
const PRIMARY_SHUTDOWN_POLL_INTERVAL_MS = 200;

class FluxionPrimaryController {
  private readonly workers = new Map<number, WorkerState>();
  private readonly routeRequests = new Map<
    number,
    { resolve: (routes: FluxionRouteMeta[]) => void; timer: NodeJS.Timeout }
  >();
  private readonly restartLog = new Map<number, number[]>();
  private readonly configPath: string;
  private readonly restartWhen;
  private readonly workerCount: number;

  private routeRequestId = 0;
  private pingTimer?: NodeJS.Timeout;
  private metaServer: Server;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;
  private cronjobWorker: cluster.Worker | null = null;

  constructor(private readonly cx: Pick<FluxionContext, 'logger' | 'options' | 'router'>) {
    this.configPath = path.join(cx.options.moduleDir || process.cwd(), 'fluxion.config.ts');
    this.restartWhen = cx.options.workerOptions.restartWhen;

    this.metaServer = createPrimaryMetaApiServer(
      this.cx,
      () => this.getWorkersSnapshot(),
      () => this.getRoutesSnapshot(),
    );

    const cpuCount = Math.max(1, os.cpus().length);
    this.workerCount = Math.max(
      1,
      Math.min(cx.options.workerOptions.maxWorkerCount ?? Math.min(2, cpuCount), cpuCount),
    );
  }

  async start(): Promise<void> {
    await launchFluxionInstance(this.configPath, this.cx.options.host, this.cx.options.port, this.cx.options.metaPort);

    this.cx.logger.info({
      message: 'PrimaryStarted',
      pid: process.pid,
      workers: this.workerCount,
      host: this.cx.options.host,
      port: this.cx.options.port,
      metaPort: this.cx.options.metaPort,
    });

    this.registerProcessHandlers();

    for (let i = 0; i < this.workerCount; i++) {
      this.spawnSlot(i + 1);
    }

    this.startPingLoop();

    // ! CronJobWatcher will check cronjobDir to be non-null
    if (this.cx.options.cronjobDir) {
      this.spawnCronjobWorker();
    }
  }

  private registerProcessHandlers(): void {
    const handleShutdownSignal = (signal: NodeJS.Signals) => {
      void this.beginShutdown(signal);
    };

    process.once('SIGINT', () => handleShutdownSignal('SIGINT'));
    process.once('SIGTERM', () => handleShutdownSignal('SIGTERM'));
  }

  private restartCountInWindow(slot: number): number {
    const now = Date.now();
    const log = (this.restartLog.get(slot) ?? []).filter((t) => now - t < RESTART_WINDOW_MS);
    this.restartLog.set(slot, log);
    return log.length;
  }

  private recordRestart(slot: number): void {
    const now = Date.now();
    const log = (this.restartLog.get(slot) ?? []).filter((t) => now - t < RESTART_WINDOW_MS);
    log.push(now);
    this.restartLog.set(slot, log);
  }

  private isStorming(slot: number): boolean {
    return this.restartCountInWindow(slot) >= MAX_RESTARTS_PER_WINDOW;
  }

  private getWorkersSnapshot() {
    return {
      primaryPid: process.pid,
      host: this.cx.options.host,
      port: this.cx.options.port,
      metaPort: this.cx.options.metaPort,
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      shuttingDown: this.shuttingDown,
      workers: Array.from(this.workers.entries()).map(([workerId, info]) => {
        const { instance } = info;
        const stats = info.lastStats;
        return {
          workerId,
          slot: info.slot,
          pid: info.pid ?? instance.process.pid ?? null,
          state: info.state,
          restartReason: info.restartReason ?? null,
          createdAt: info.createdAt,
          readyAt: info.readyAt ?? null,
          connected: instance.isConnected(),
          dead: instance.isDead(),
          exitedAfterDisconnect: instance.exitedAfterDisconnect,
          lastPongAt: info.lastPongAt ?? null,
          lastRttMs: info.lastRttMs ?? null,
          stats:
            stats === undefined
              ? null
              : {
                  at: stats.at,
                  uptimeSeconds: stats.uptimeSeconds,
                  cpu: stats.cpu,
                  memory: {
                    ...stats.memory,
                    rssMb: bytesToMb(stats.memory.rss),
                    heapTotalMb: bytesToMb(stats.memory.heapTotal),
                    heapUsedMb: bytesToMb(stats.memory.heapUsed),
                    externalMb: bytesToMb(stats.memory.external),
                    arrayBuffersMb: bytesToMb(stats.memory.arrayBuffers),
                  },
                },
        };
      }),
    };
  }

  private getRoutesSnapshot(): Promise<FluxionRouteMeta[]> {
    const worker = Array.from(this.workers.values()).find(
      (info) => info.state === 'ready' && info.instance.isConnected(),
    );
    if (!worker) {
      return Promise.resolve([]);
    }

    return new Promise((resolve) => {
      const requestId = ++this.routeRequestId;
      const timer = setTimeout(() => {
        this.routeRequests.delete(requestId);
        resolve([]);
      }, ROUTES_TIMEOUT_MS);
      timer.unref();
      this.routeRequests.set(requestId, { resolve, timer });
      try {
        sendToWorker(worker.instance, { type: PrimaryAction.Routes, requestId });
      } catch {
        clearTimeout(timer);
        this.routeRequests.delete(requestId);
        resolve([]);
      }
    });
  }

  private initiateRecycle(info: WorkerState, reason: string): void {
    if (this.shuttingDown) {
      return;
    }

    for (const workerInfo of this.workers.values()) {
      if (workerInfo.state === 'restarting') return;
    }

    if (this.isStorming(info.slot)) {
      this.cx.logger.warn({
        message: 'WorkerRecycleSuppressed',
        slot: info.slot,
        pid: info.pid,
        reason,
        windowMs: RESTART_WINDOW_MS,
        max: MAX_RESTARTS_PER_WINDOW,
      });
      return;
    }

    this.recordRestart(info.slot);
    info.state = 'restarting';
    info.restartReason = reason;
    this.cx.logger.warn({
      message: 'WorkerRecycling',
      slot: info.slot,
      pid: info.pid,
      reason,
    });
    info.instance.kill();
  }

  private evaluateResourceConditions(info: WorkerState, stats: WorkerRuntimeStats): void {
    if (this.shuttingDown) {
      return;
    }

    const rssMb = bytesToMb(stats.memory.rss);
    if (rssMb > this.restartWhen.memoryUsageGreaterThan) {
      this.initiateRecycle(
        info,
        `memoryUsageGreaterThan: rss ${rssMb}MB > ${this.restartWhen.memoryUsageGreaterThan}MB`,
      );
      return;
    }

    const uptimeMs = stats.uptimeSeconds * 1000;
    if (uptimeMs > this.restartWhen.uptimeGreaterThan) {
      this.initiateRecycle(
        info,
        `uptimeGreaterThan: ${Math.round(uptimeMs / 1000)}s > ${Math.round(this.restartWhen.uptimeGreaterThan / 1000)}s`,
      );
    }
  }

  private evaluateLiveness(now: number): void {
    if (this.shuttingDown) {
      return;
    }

    for (const info of this.workers.values()) {
      if (info.state !== 'ready' || info.lastPongAt === undefined) continue;
      const staleMs = now - info.lastPongAt;
      if (staleMs > this.restartWhen.healthzTimeout) {
        this.initiateRecycle(
          info,
          `healthzTimeout: no pong for ${Math.round(staleMs / 1000)}s > ${Math.round(this.restartWhen.healthzTimeout / 1000)}s`,
        );
      }
    }
  }

  private spawnSlot(slot: number): void {
    if (this.shuttingDown) {
      return;
    }

    this.attachWorker(cluster.fork({ WORKER_ID: String(slot) }), slot);
  }

  private spawnCronjobWorker(): void {
    if (this.shuttingDown) {
      return;
    }

    this.attachCronjobWorker(cluster.fork({ FLUXION_WORKER_TYPE: 'cronjob' }));
  }

  private attachCronjobWorker(worker: cluster.Worker): void {
    this.cronjobWorker = worker;

    worker.on('message', (raw: WorkerMessage) => {
      if (!isWorkerMessage(raw)) {
        return;
      }

      if (raw.type === WorkerAction.Created) {
        this.cx.logger.info({
          message: 'CronjobWorkerCreated',
          pid: raw.pid,
        });
        return;
      }

      if (raw.type === WorkerAction.Ready) {
        this.cx.logger.info({
          message: 'CronjobWorkerReady',
          pid: raw.pid,
        });
      }
    });

    worker.on('exit', (code, signal) => {
      const pid = worker.process.pid;
      this.cx.logger.warn({
        message: 'CronjobWorkerExited',
        pid: pid ?? 'unknown',
        code,
        signal: signal ?? 'none',
        expected: this.shuttingDown,
      });

      if (this.shuttingDown) {
        return;
      }

      this.cx.logger.info({ message: 'CronjobWorkerRespawning' });
      this.spawnCronjobWorker();
    });
  }

  private attachWorker(worker: cluster.Worker, slot: number): void {
    const workerInfo: WorkerState = {
      state: 'creating',
      pid: worker.process.pid,
      slot,
      createdAt: Date.now(),
      instance: worker,
    };
    this.workers.set(worker.id, workerInfo);

    worker.on('message', (raw: WorkerMessage) => {
      if (!isWorkerMessage(raw)) {
        return;
      }

      if (raw.type === WorkerAction.Pong) {
        const rtt = Date.now() - raw.sentAt;
        workerInfo.pid = raw.pid;
        workerInfo.lastPongAt = Date.now();
        workerInfo.lastRttMs = rtt;
        return;
      }

      if (raw.type === WorkerAction.Ready) {
        workerInfo.state = 'ready';
        workerInfo.pid = raw.pid;
        workerInfo.readyAt = Date.now();
        this.cx.logger.info({
          message: 'WorkerReady',
          workerId: worker.id,
          slot,
          pid: raw.pid,
        });
        return;
      }

      if (raw.type === WorkerAction.Created) {
        workerInfo.state = 'created';
        workerInfo.pid = raw.pid;
        this.cx.logger.info({
          message: 'WorkerCreated',
          workerId: worker.id,
          slot,
          pid: raw.pid,
        });
        return;
      }

      if (raw.type === WorkerAction.Stats) {
        workerInfo.pid = raw.pid;
        workerInfo.lastStats = raw.stats;
        if (workerInfo.state === 'ready') {
          this.evaluateResourceConditions(workerInfo, raw.stats);
        }
        return;
      }

      if (raw.type === WorkerAction.Routes) {
        const request = this.routeRequests.get(raw.requestId);
        if (request) {
          clearTimeout(request.timer);
          this.routeRequests.delete(raw.requestId);
          request.resolve(raw.routes);
        }
      }
    });

    worker.on('exit', (code, signal) => {
      const info = this.workers.get(worker.id);
      this.workers.delete(worker.id);
      const exitedSlot = info?.slot;
      const expected = info?.state === 'restarting' || this.shuttingDown;
      const reason = info?.restartReason ?? (this.shuttingDown ? 'shutdown' : null);

      this.cx.logger.warn({
        message: 'WorkerExited',
        workerId: worker.id,
        slot: exitedSlot ?? null,
        pid: worker.process.pid ?? 'unknown',
        code,
        signal: signal ?? 'none',
        expected,
        reason,
      });

      if (exitedSlot === undefined || this.shuttingDown) return;

      if (info?.state === 'restarting') {
        this.spawnSlot(exitedSlot);
        return;
      }

      this.recordRestart(exitedSlot);
      if (this.isStorming(exitedSlot)) {
        this.cx.logger.error({
          message: 'WorkerRespawnSuppressed',
          slot: exitedSlot,
          windowMs: RESTART_WINDOW_MS,
          max: MAX_RESTARTS_PER_WINDOW,
        });
        return;
      }
      this.spawnSlot(exitedSlot);
    });
  }

  private startPingLoop(): void {
    this.pingTimer = setInterval(() => {
      const sentAt = Date.now();
      for (const info of this.workers.values()) {
        if (!info.instance.isConnected()) {
          continue;
        }
        try {
          sendToWorker(info.instance, { type: PrimaryAction.Ping, sentAt });
        } catch {
          // Ignore transient IPC errors; worker lifecycle events will reconcile state.
        }
      }
      this.evaluateLiveness(Date.now());
    }, PING_INTERVAL_MS);
    this.pingTimer.unref();
  }

  private stopTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }

    for (const [requestId, request] of this.routeRequests.entries()) {
      clearTimeout(request.timer);
      request.resolve([]);
      this.routeRequests.delete(requestId);
    }
  }

  private getAliveWorkers(): WorkerState[] {
    return Array.from(this.workers.values()).filter((info) => !info.instance.isDead());
  }

  private async waitForWorkersToExit(timeoutMs: number): Promise<WorkerState[]> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const alive = this.getAliveWorkers();
      if (alive.length === 0) {
        return [];
      }

      await new Promise((resolve) => {
        setTimeout(resolve, PRIMARY_SHUTDOWN_POLL_INTERVAL_MS);
      });
    }

    return this.getAliveWorkers();
  }

  private async forceKillWorkers(workers: WorkerState[]): Promise<void> {
    for (const info of workers) {
      const pid = info.pid ?? info.instance.process.pid;
      this.cx.logger.error({
        message: 'WorkerForceKilled',
        slot: info.slot,
        pid: pid ?? null,
      });

      try {
        info.instance.process.kill('SIGKILL');
      } catch {
        // Ignore races where the worker exits between timeout and force kill.
      }
    }

    await this.waitForWorkersToExit(1000);
  }

  private async shutdownWorkers(signal: NodeJS.Signals): Promise<void> {
    const workers = this.getAliveWorkers();
    for (const info of workers) {
      const pid = info.pid ?? info.instance.process.pid;
      this.cx.logger.warn({
        message: 'WorkerShutdownRequested',
        slot: info.slot,
        pid: pid ?? null,
        signal,
      });

      try {
        info.instance.kill(signal);
      } catch {
        // Ignore races; exit listener will reconcile state.
      }
    }

    // Kill cronjob worker
    if (this.cronjobWorker && !this.cronjobWorker.isDead()) {
      this.cx.logger.warn({
        message: 'CronjobWorkerShutdownRequested',
        pid: this.cronjobWorker.process.pid ?? null,
        signal,
      });
      try {
        this.cronjobWorker.kill(signal);
      } catch {
        // Ignore races; exit listener will reconcile state.
      }
    }

    const remaining = await this.waitForWorkersToExit(PRIMARY_SHUTDOWN_TIMEOUT_MS);
    if (remaining.length === 0) {
      return;
    }

    this.cx.logger.error({
      message: 'PrimaryShutdownTimeout',
      pid: process.pid,
      remainingWorkers: remaining.map((info) => ({
        slot: info.slot,
        pid: info.pid ?? info.instance.process.pid ?? null,
      })),
      timeoutMs: PRIMARY_SHUTDOWN_TIMEOUT_MS,
    });

    await this.forceKillWorkers(remaining);
  }

  private async beginShutdown(signal: NodeJS.Signals): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = (async () => {
      this.shuttingDown = true;
      this.cx.logger.warn({
        message: 'PrimaryShuttingDown',
        pid: process.pid,
        signal,
        workerCount: this.workers.size,
      });

      this.stopTimers();

      try {
        await this.shutdownWorkers(signal);
      } finally {
        this.metaServer.close();
        await cleanupFluxionInstance();
      }
    })();

    try {
      await this.shutdownPromise;
      process.exit(0);
    } catch (error) {
      this.cx.logger.error({
        message: 'PrimaryShutdownFailed',
        pid: process.pid,
        signal,
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  }
}

export async function initPrimary(cx: Pick<FluxionContext, 'logger' | 'options' | 'router'>) {
  if (!cluster.isPrimary) {
    $throw('createPrimary should only be called in primary process');
  }

  const controller = new FluxionPrimaryController(cx);
  await controller.start();
}
