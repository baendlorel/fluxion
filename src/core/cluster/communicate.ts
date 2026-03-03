import type cluster from 'node:cluster';
import type { PrimaryMessage, WorkerMessage } from './types.js';

export const sendToPrimary = (message: WorkerMessage) => process.send?.(message);

export const sendToWorker = (worker: cluster.Worker, message: PrimaryMessage) => worker.send(message);
