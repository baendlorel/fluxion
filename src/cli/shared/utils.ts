import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOCKET_PATH, readPidFile, isPidAlive } from '../shared/store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 确保 God Daemon 在运行。
 * 如果 daemon 不在运行，则启动它（detached + unref）。
 */
export function ensureDaemonRunning(): Promise<void> {
  // 检查 daemon 是否在运行
  const pid = readPidFile();
  if (pid !== null && isPidAlive(pid)) {
    return Promise.resolve(); // daemon 已在运行
  }

  // 启动 God Daemon
  return new Promise<void>((resolvePromise, reject) => {
    const daemonScript = resolve(__dirname, '../daemon.js');
    const tsScript = resolve(__dirname, '../daemon.ts');
    // 从已安装的包中查找（dist/cli/daemon.js）
    const distScript = resolve(__dirname, '../../dist/cli/daemon.js');
    // 查找编译后的产物（与 cli/index.mjs 同目录的 daemon.mjs）
    const bundledScript = resolve(__dirname, 'daemon.mjs');

    let scriptPath: string;
    let interpreter: string;

    if (existsSync(daemonScript)) {
      scriptPath = daemonScript;
      interpreter = process.execPath;
    } else if (existsSync(tsScript)) {
      scriptPath = tsScript;
      interpreter = 'tsx';
    } else if (existsSync(bundledScript)) {
      scriptPath = bundledScript;
      interpreter = process.execPath;
    } else if (existsSync(distScript)) {
      scriptPath = distScript;
      interpreter = process.execPath;
    } else {
      reject(new Error('Cannot find daemon script'));
      return;
    }

    const child = spawn(interpreter, [scriptPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // 等待 socket 文件出现（最多 3 秒）
    const startTime = Date.now();
    const check = () => {
      if (existsSync(SOCKET_PATH)) {
        resolvePromise();
        return;
      }
      if (Date.now() - startTime > 3000) {
        reject(new Error('Daemon socket did not appear within 3s'));
        return;
      }
      setTimeout(check, 100);
    };
    setTimeout(check, 300);
  });
}