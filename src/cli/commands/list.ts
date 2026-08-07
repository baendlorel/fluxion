import { sendIpcMessage } from '../shared/ipc.js';
import type { InstanceInfo } from '../shared/types.js';

function formatUptime(startTime: number): string {
  const diff = Date.now() - startTime;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

function padEnd(s: string, len: number): string {
  return s + ' '.repeat(Math.max(0, len - s.length));
}

export async function list(): Promise<void> {
  try {
    const result = (await sendIpcMessage('list')) as InstanceInfo[];

    if (!result || result.length === 0) {
      console.log('No instances running.');
      return;
    }

    // 表头
    const header = `${padEnd('UID', 14)} ${padEnd('Status', 9)} ${padEnd('Pid', 7)} ${padEnd('Entry', 24)} ${padEnd('Uptime', 10)} Restarts`;
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const inst of result) {
      const uid = padEnd(inst.uid, 14);
      const status = padEnd(inst.status, 9);
      const pid = inst.status === 'online' ? padEnd(String(inst.pid), 7) : padEnd('-', 7);
      const entry = padEnd(inst.entry.length > 22 ? '...' + inst.entry.slice(-19) : inst.entry, 24);
      const uptime = inst.status === 'online' ? padEnd(formatUptime(inst.startTime), 10) : padEnd('-', 10);
      const restarts = String(inst.restartCount);

      console.log(`${uid} ${status} ${pid} ${entry} ${uptime} ${restarts}`);
    }
  } catch (e) {
    // daemon 不在运行
    console.log('Daemon is not running. No instances.');
  }
}