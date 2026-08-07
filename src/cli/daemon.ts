/**
 * God Daemon —— 常驻后台的进程管理器。
 *
 * 启动方式：被 CLI 通过 detached + unref 方式 spawn，或由 systemd 管理。
 * 生命周期：常驻直到收到 shutdown 指令或被 kill。
 * 职责：监听 Unix Socket 处理 IPC 请求，管理子进程实例，自动重启崩溃的实例。
 */

import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, createWriteStream, chmodSync, type WriteStream } from 'node:fs';
import { resolve } from 'node:path';
import type { IpcMessage, NormalizedFluxionInstanceOptions, InstanceInfo, InstanceStatus } from './shared/types.js';
import { computeUid } from './shared/uid.js';
import {
  SOCKET_PATH,
  INSTANCES_DIR,
  LOGS_DIR,
  ensureDirectories,
  writePidFile,
  removePidFile,
  removeSocketFile,
  isPidAlive,
  writeInstanceFile,
  removeInstanceFile,
  listInstanceFiles,
} from './shared/store.js';

interface ManagedInstance {
  uid: string;
  pid: number;
  process: import('node:child_process').ChildProcess;
  config: NormalizedFluxionInstanceOptions;
  status: InstanceStatus;
  startTime: number;
  restartCount: number;
  logStream: WriteStream | null;
}

const instances = new Map<string, ManagedInstance>();
let server: ReturnType<typeof createServer> | null = null;

// ─── 子进程管理 ────────────────────────────────────────────────

function spawnInstance(config: NormalizedFluxionInstanceOptions): string {
  const uid = computeUid(config.cwd, config.entry);

  // 检查是否已运行
  const existing = instances.get(uid);
  if (existing && existing.status === 'online' && isPidAlive(existing.pid)) {
    throw new Error(`Instance already running: ${uid}`);
  }

  const logPath = resolve(LOGS_DIR, `${uid}.log`);
  const logStream = createWriteStream(logPath, { flags: 'a' });

  const child = spawn(config.interpreter, [config.entry], {
    cwd: config.cwd,
    env: config.env as Record<string, string>,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  const instance: ManagedInstance = {
    uid,
    pid: child.pid!,
    process: child,
    config,
    status: 'online',
    startTime: Date.now(),
    restartCount: existing?.restartCount ?? 0,
    logStream,
  };

  instances.set(uid, instance);
  writeInstanceInfo(uid, instance);

  child.on('exit', (code, signal) => {
    instance.status = code === 0 || signal === 'SIGTERM' ? 'stopped' : 'errored';
    instance.logStream?.end();
    instance.logStream = null;
    writeInstanceInfo(uid, instance);

    console.error(`[fluxion-daemon] Instance ${uid} exited (code=${code}, signal=${signal}), status=${instance.status}`);

    // 自动重启：只有 online 状态的实例才重启（stopped 是用户主动停止的）
    if (instance.restartCount < config.maxRestarts) {
      instance.restartCount++;
      console.error(`[fluxion-daemon] Restarting ${uid} (${instance.restartCount}/${config.maxRestarts})`);
      try {
        spawnInstance(config);
      } catch (e) {
        console.error(`[fluxion-daemon] Failed to restart ${uid}:`, e);
      }
    } else {
      console.error(`[fluxion-daemon] ${uid} reached max restarts (${config.maxRestarts}), giving up`);
    }
  });

  child.on('error', (err) => {
    console.error(`[fluxion-daemon] Failed to spawn ${uid}:`, err);
    instance.status = 'errored';
    writeInstanceInfo(uid, instance);
  });

  return uid;
}

function writeInstanceInfo(uid: string, instance: ManagedInstance): void {
  const info: InstanceInfo = {
    uid: instance.uid,
    pid: instance.pid,
    status: instance.status,
    startTime: instance.startTime,
    restartCount: instance.restartCount,
    maxRestarts: instance.config.maxRestarts,
    cwd: instance.config.cwd,
    entry: instance.config.entry,
    interpreter: instance.config.interpreter,
    env: instance.config.env,
  };
  writeInstanceFile(uid, info);
}

function stopInstance(uid: string): Promise<void> {
  const instance = instances.get(uid);
  if (!instance) {
    throw new Error(`Instance not found: ${uid}`);
  }

  if (instance.status === 'stopped') {
    // already stopped
    return Promise.resolve();
  }

  return new Promise((resolvePromise) => {
    const killTimer = setTimeout(() => {
      // 超时则 SIGKILL
      try {
        instance.process.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, 5000);

    instance.process.once('exit', () => {
      clearTimeout(killTimer);
      instance.status = 'stopped';
      instance.logStream?.end();
      instance.logStream = null;
      writeInstanceInfo(uid, instance);
      resolvePromise();
    });

    try {
      instance.process.kill('SIGTERM');
    } catch {
      clearTimeout(killTimer);
      instance.status = 'stopped';
      writeInstanceInfo(uid, instance);
      resolvePromise();
    }
  });
}

// ─── 复活机制 ────────────────────────────────────────────────

function resurrect(): void {
  const files = listInstanceFiles();
  for (const info of files) {
    if (info.status === 'online') {
      // 检查进程是否还活着
      if (!isPidAlive(info.pid)) {
        console.error(`[fluxion-daemon] Resurrecting ${info.uid} (pid ${info.pid} dead)`);
        const config: NormalizedFluxionInstanceOptions = {
          interpreter: info.interpreter,
          cwd: info.cwd,
          entry: info.entry,
          maxRestarts: info.maxRestarts,
          env: info.env,
        };
        try {
          spawnInstance(config);
        } catch (e) {
          console.error(`[fluxion-daemon] Failed to resurrect ${info.uid}:`, e);
        }
      } else {
        // Process already alive, register in memory
        console.error(`[fluxion-daemon] ${info.uid} (pid ${info.pid}) already alive`);
        // Store the instance info in memory so list shows it
        // Note: we cannot attach to the existing process, so we won't manage its lifecycle
      }
    }
  }
}

// ─── IPC 消息处理 ──────────────────────────────────────────────

function sendResponse(socket: import('node:net').Socket, msg: IpcMessage, result?: unknown, error?: { code: string; message: string }): void {
  const res: IpcMessage = {
    id: msg.id,
    type: 'res',
    method: msg.method,
    result,
    error,
  };
  socket.write(JSON.stringify(res) + '\n');
}

function handleMessage(msg: IpcMessage, socket: import('node:net').Socket): void {
  switch (msg.method) {
    case 'start':
      handleStart(msg, socket);
      break;
    case 'stop':
      handleStop(msg, socket).catch(() => {});
      break;
    case 'restart':
      handleRestart(msg, socket).catch(() => {});
      break;
    case 'list':
      handleList(msg, socket);
      break;
    case 'shutdown':
      handleShutdown(msg, socket).catch(() => {});
      break;
    case 'ping':
      sendResponse(socket, msg, { ok: true });
      break;
    default:
      sendResponse(socket, msg, undefined, {
        code: 'UNKNOWN_METHOD',
        message: `Unknown method: ${msg.method}`,
      });
  }
}

function handleStart(msg: IpcMessage, socket: import('node:net').Socket): void {
  try {
    const config = msg.params?.config as NormalizedFluxionInstanceOptions;
    if (!config) {
      return sendResponse(socket, msg, undefined, { code: 'INVALID_PARAMS', message: 'Missing config' });
    }
    const uid = spawnInstance(config);
    const instance = instances.get(uid)!;
    sendResponse(socket, msg, { uid, pid: instance.pid });
  } catch (e) {
    sendResponse(socket, msg, undefined, {
      code: 'START_FAILED',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function handleStop(msg: IpcMessage, socket: import('node:net').Socket): Promise<void> {
  try {
    const uid = msg.params?.uid as string;
    if (!uid) {
      return sendResponse(socket, msg, undefined, { code: 'INVALID_PARAMS', message: 'Missing uid' });
    }
    await stopInstance(uid);
    sendResponse(socket, msg, { uid, status: 'stopped' });
  } catch (e) {
    sendResponse(socket, msg, undefined, {
      code: 'STOP_FAILED',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function handleRestart(msg: IpcMessage, socket: import('node:net').Socket): Promise<void> {
  try {
    const uid = msg.params?.uid as string;
    if (!uid) {
      return sendResponse(socket, msg, undefined, { code: 'INVALID_PARAMS', message: 'Missing uid' });
    }
    const existing = instances.get(uid);
    if (!existing) {
      return sendResponse(socket, msg, undefined, { code: 'NOT_FOUND', message: `Instance not found: ${uid}` });
    }
    const config = existing.config;

    await stopInstance(uid);
    // 重置重启计数
    const newUid = spawnInstance(config);
    const instance = instances.get(newUid)!;
    sendResponse(socket, msg, { uid: newUid, pid: instance.pid });
  } catch (e) {
    sendResponse(socket, msg, undefined, {
      code: 'RESTART_FAILED',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

function handleList(_msg: IpcMessage, socket: import('node:net').Socket): void {
  const list: InstanceInfo[] = [];
  for (const instance of instances.values()) {
    list.push({
      uid: instance.uid,
      pid: instance.pid,
      status: instance.status,
      startTime: instance.startTime,
      restartCount: instance.restartCount,
      maxRestarts: instance.config.maxRestarts,
      cwd: instance.config.cwd,
      entry: instance.config.entry,
      interpreter: instance.config.interpreter,
      env: instance.config.env,
    });
  }
  sendResponse(socket, _msg, list);
}

async function handleShutdown(msg: IpcMessage, socket: import('node:net').Socket): Promise<void> {
  // 先回复，再关闭
  sendResponse(socket, msg, { ok: true });

  // 停止所有子进程
  const stopPromises: Promise<void>[] = [];
  for (const [uid] of instances) {
    stopPromises.push(
      stopInstance(uid).catch(() => {
        // ignore
      }),
    );
  }
  await Promise.all(stopPromises);

  // 关闭 server
  server?.close();

  // 清理文件
  removeSocketFile();
  removePidFile();

  console.error('[fluxion-daemon] Shutdown complete');
  process.exit(0);
}

// ─── 服务器启动 ────────────────────────────────────────────────

function startDaemon(): void {
  ensureDirectories();
  writePidFile(process.pid);

  // 复活之前的实例
  resurrect();

  server = createServer((socket) => {
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as IpcMessage;
          handleMessage(msg, socket);
        } catch {
          // ignore invalid JSON
        }
      }
    });
  });

  // 确保之前残留的 socket 被清理
  removeSocketFile();

  server.listen(SOCKET_PATH, () => {
    try {
      chmodSync(SOCKET_PATH, 0o600);
      chmodSync(SOCKET_PATH, 0o600);
    } catch {
      // ignore
    }
    console.error(`[fluxion-daemon] Listening on ${SOCKET_PATH} (pid ${process.pid})`);
  });

  // 优雅退出
  process.on('SIGTERM', () => shutdownDaemon());
  process.on('SIGINT', () => shutdownDaemon());
  process.on('SIGQUIT', () => shutdownDaemon());

  // 保持进程存活
  process.stdin.resume();
}

function shutdownDaemon(): void {
  console.error('[fluxion-daemon] Received shutdown signal');

  // 停止所有子进程
  const stopPromises: Promise<void>[] = [];
  for (const [uid] of instances) {
    stopPromises.push(
      stopInstance(uid).catch(() => {
        // ignore
      }),
    );
  }

  Promise.all(stopPromises).then(() => {
    server?.close();
    removeSocketFile();
    removePidFile();
    process.exit(0);
  });
}

// ─── 入口 ────────────────────────────────────────────────────

startDaemon();