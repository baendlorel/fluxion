import { sendIpcMessage } from '../shared/ipc.js';

export async function stop(uid: string): Promise<void> {
  if (!uid) {
    console.error('Usage: fluxion stop <uid>');
    process.exit(1);
  }

  try {
    await sendIpcMessage('stop', { uid });
    console.log(`Stopped ${uid}`);
  } catch (e) {
    console.error('Failed to stop instance:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}