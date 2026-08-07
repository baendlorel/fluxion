import { connect } from 'node:net';
import type { IpcMessage } from './types.js';
import { SOCKET_PATH } from './store.js';

let _messageId = 0;
function nextId(): string {
  return String(++_messageId);
}

/**
 * 通过 Unix Socket 向 daemon 发送 IPC 消息并等待响应。
 * 超时时间默认 5 秒。
 */
export function sendIpcMessage(
  method: string,
  params?: Record<string, unknown>,
  timeout = 5000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCKET_PATH, () => {
      const msg: IpcMessage = {
        id: nextId(),
        type: 'req',
        method,
        params,
      };
      socket.write(JSON.stringify(msg) + '\n');
    });

    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`IPC request timed out after ${timeout}ms`));
    }, timeout);

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const res: IpcMessage = JSON.parse(line);
          if (res.type === 'res') {
            clearTimeout(timer);
            socket.end();
            if (res.error) {
              reject(new Error(`[${res.error.code}] ${res.error.message}`));
            } else {
              resolve(res.result);
            }
          }
        } catch {
          // ignore partial JSON
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.on('close', () => {
      clearTimeout(timer);
    });
  });
}