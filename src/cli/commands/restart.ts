import { sendIpcMessage } from '../shared/ipc.js';

export async function restart(uid: string): Promise<void> {
  if (!uid) {
    console.error('Usage: fluxion restart <uid>');
    process.exit(1);
  }

  try {
    const result = (await sendIpcMessage('restart', { uid })) as { uid: string; pid: number };
    console.log(`Restarted ${result.uid} (pid ${result.pid})`);
  } catch (e) {
    console.error('Failed to restart instance:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}