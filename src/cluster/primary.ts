import type { WorkerMessage, WorkerState, WorkerRuntimeStats } from './types.js';
import type { FluxionContext, FluxionRouteMeta } from '../types.js';
import os from 'node:os';
import cluster from 'node:cluster';
import path from 'node:path';

import { isWorkerMessage, WorkerAction, PrimaryAction } from './consts.js';
import { sendToWorker } from './communicate.js';
import { createPrimaryMetaApiServer } from './meta-api.js';
import { launchFluxionInstance } from './launcher.js';

const bytesToMb = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(2));

/**
 * Anti-storm guard shared by proactive recycle (restartWhen) and reactive
 * respawn (crash). A slot may be restarted at most MAX_RESTARTS_PER_WINDOW
 * times within RESTART_WINDOW_MS; further attempts are suppressed and alerted
 * rather than fork-bombing. The window is rolling, so a quiet minute restores
 * capacity — it throttles, never kills a slot permanently.
 */
const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS_PER_WINDOW = 3;

export async function initPrimary(cx: Pick<FluxionContext, 'logger' | 'options' | 'router'>) {
  if (!cluster.isPrimary) {
    $throw('createPrimary should only be called in primary process');
  }

  // 注册当前 fluxion 实例
  const configPath = path.join(cx.options.moduleDir || process.cwd(), 'fluxion.config.ts');
  await launchFluxionInstance(configPath, cx.options.host, cx.options.port, cx.options.metaPort);

  const { workerOptions } = cx.options;
  const restartWhen = workerOptions.restartWhen;
  const cpuCount = Math.max(1, os.cpus().length);
  const workerCount = Math.max(1, Math.min(workerOptions.maxWorkerCount ?? Math.min(2, cpuCount), cpuCount));

  cx.logger.info({
    message: 'PrimaryStarted',
    pid: process.pid,
    workers: workerCount,
    host: cx.options.host,
    port: cx.options.port,
    metaPort: cx.options.metaPort,
  });

  const workers = new Map<number, WorkerState>();
  const routeRequests = new Map<number, { resolve: (routes: FluxionRouteMeta[]) => void; timer: NodeJS.Timeout }>();
  let routeRequestId = 0;

  // slot -> recent restart timestamps (pruned to RESTART_WINDOW_MS on access).
  // Keyed by the stable 1-based slot, not cluster's worker.id (which changes
  // on every fork), so history survives respawn cycles.
  const restartLog = new Map<number, number[]>();

  const restartCountInWindow = (slot: number) => {
    const now = Date.now();
    const log = (restartLog.get(slot) ?? []).filter((t) => now - t < RESTART_WINDOW_MS);
    restartLog.set(slot, log);
    return log.length;
  };

  const recordRestart = (slot: number) => {
    const now = Date.now();
    const log = (restartLog.get(slot) ?? []).filter((t) => now - t < RESTART_WINDOW_MS);
    log.push(now);
    restartLog.set(slot, log);
  };

  const isStorming = (slot: number) => restartCountInWindow(slot) >= MAX_RESTARTS_PER_WINDOW;

  const getWorkersSnapshot = () => {
    return {
      primaryPid: process.pid,
      host: cx.options.host,
      port: cx.options.port,
      metaPort: cx.options.metaPort,
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      workers: Array.from(workers.entries()).map(([workerId, info]) => {
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
  };

  createPrimaryMetaApiServer(cx, getWorkersSnapshot, () => {
    const worker = Array.from(workers.values()).find((info) => info.state === 'ready' && info.instance.isConnected());
    if (!worker) {
      return Promise.resolve([]);
    }

    return new Promise((resolve) => {
      const requestId = ++routeRequestId;
      const timer = setTimeout(() => {
        routeRequests.delete(requestId);
        resolve([]);
      }, 1000);
      timer.unref();
      routeRequests.set(requestId, { resolve, timer });
      try {
        sendToWorker(worker.instance, { type: PrimaryAction.Routes, requestId });
      } catch {
        clearTimeout(timer);
        routeRequests.delete(requestId);
        resolve([]);
      }
    });
  });

  // Recycle a worker via hard kill (SIGTERM). Guards enforce one-at-a-time
  // (so a workload-wide condition rolls restarts instead of nuking the pool)
  // and the anti-storm window. Note: relies on the worker's default SIGTERM
  // disposition to exit; fluxion workers never trap SIGTERM.
  const initiateRecycle = (info: WorkerState, reason: string) => {
    for (const w of workers.values()) {
      if (w.state === 'restarting') return; // another recycle in flight; retried next tick
    }
    if (isStorming(info.slot)) {
      cx.logger.warn({
        message: 'WorkerRecycleSuppressed',
        slot: info.slot,
        pid: info.pid,
        reason,
        windowMs: RESTART_WINDOW_MS,
        max: MAX_RESTARTS_PER_WINDOW,
      });
      return;
    }
    recordRestart(info.slot);
    info.state = 'restarting';
    info.restartReason = reason;
    cx.logger.warn({
      message: 'WorkerRecycling',
      slot: info.slot,
      pid: info.pid,
      reason,
    });
    info.instance.kill();
  };

  // Evaluate memory + uptime against a fresh stats report. Runs on every
  // Stats message (~every 2s), so reaction latency is bounded by the stats
  // interval, not the ping interval. Infinity thresholds short-circuit here.
  const evaluateResourceConditions = (info: WorkerState, stats: WorkerRuntimeStats) => {
    const rssMb = bytesToMb(stats.memory.rss);
    if (rssMb > restartWhen.memoryUsageGreaterThan) {
      initiateRecycle(info, `memoryUsageGreaterThan: rss ${rssMb}MB > ${restartWhen.memoryUsageGreaterThan}MB`);
      return;
    }
    const uptimeMs = stats.uptimeSeconds * 1000;
    if (uptimeMs > restartWhen.uptimeGreaterThan) {
      initiateRecycle(
        info,
        `uptimeGreaterThan: ${Math.round(uptimeMs / 1000)}s > ${Math.round(restartWhen.uptimeGreaterThan / 1000)}s`,
      );
    }
  };

  // Evaluate liveness against the last pong. Runs on the ping tick (5s); a
  // wedged worker stops replying, lastPongAt goes stale past the threshold.
  const evaluateLiveness = (now: number) => {
    for (const info of workers.values()) {
      if (info.state !== 'ready' || info.lastPongAt === undefined) continue;
      const staleMs = now - info.lastPongAt;
      if (staleMs > restartWhen.healthzTimeout) {
        initiateRecycle(
          info,
          `healthzTimeout: no pong for ${Math.round(staleMs / 1000)}s > ${Math.round(restartWhen.healthzTimeout / 1000)}s`,
        );
      }
    }
  };

  const spawnSlot = (slot: number) => {
    attachWorker(cluster.fork({ WORKER_ID: String(slot) }), slot);
  };

  const attachWorker = (worker: cluster.Worker, slot: number): void => {
    const workerInfo: WorkerState = {
      state: 'creating',
      pid: worker.process.pid,
      slot,
      createdAt: Date.now(),
      instance: worker,
    };
    workers.set(worker.id, workerInfo);

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
        cx.logger.info({
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
        cx.logger.info({
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
          evaluateResourceConditions(workerInfo, raw.stats);
        }
        return;
      }

      if (raw.type === WorkerAction.Routes) {
        const request = routeRequests.get(raw.requestId);
        if (request) {
          clearTimeout(request.timer);
          routeRequests.delete(raw.requestId);
          request.resolve(raw.routes);
        }
      }
    });

    worker.on('exit', (code, signal) => {
      const info = workers.get(worker.id);
      workers.delete(worker.id);
      const exitedSlot = info?.slot;
      const expected = info?.state === 'restarting';
      const reason = info?.restartReason ?? null;

      cx.logger.warn({
        message: 'WorkerExited',
        workerId: worker.id,
        slot: exitedSlot ?? null,
        pid: worker.process.pid ?? 'unknown',
        code,
        signal: signal ?? 'none',
        expected,
        reason,
      });

      if (exitedSlot === undefined) return;

      if (expected) {
        // Proactive recycle: the restart was already counted when initiated.
        spawnSlot(exitedSlot);
        return;
      }

      // Unexpected crash: count it, then respawn unless anti-storm trips.
      recordRestart(exitedSlot);
      if (isStorming(exitedSlot)) {
        cx.logger.error({
          message: 'WorkerRespawnSuppressed',
          slot: exitedSlot,
          windowMs: RESTART_WINDOW_MS,
          max: MAX_RESTARTS_PER_WINDOW,
        });
        return;
      }
      spawnSlot(exitedSlot);
    });
  };

  for (let i = 0; i < workerCount; i++) {
    spawnSlot(i + 1);
  }

  const pingTimer = setInterval(() => {
    const sentAt = Date.now();
    for (const info of workers.values()) {
      if (!info.instance.isConnected()) {
        continue;
      }
      try {
        sendToWorker(info.instance, { type: PrimaryAction.Ping, sentAt });
      } catch {
        // Ignore transient IPC errors; worker lifecycle events will reconcile state.
      }
    }
    evaluateLiveness(Date.now());
  }, 5000);
  pingTimer.unref();
}
