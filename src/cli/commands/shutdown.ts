import { sendIpcMessage } from '../shared/ipc.js';

export async function shutdown(): Promise<void> {
  try {
    await sendIpcMessage('shutdown');
    console.log('Fluxion daemon stopped');
  } catch (e) {
    console.error('Failed to shutdown daemon:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}