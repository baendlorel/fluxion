import cluster from 'node:cluster';
import { ResolvedFluxionOptions } from '../types.js';
import { WorkerToPrimaryMessage } from './types.js';
import { WorkerToPrimaryMessageType, PrimaryToWorkerMessageType, isFromPrimary } from './consts.js';

const sendToPrimary = (message: WorkerToPrimaryMessage) => process.send?.(message);

export async function createWorker(options: ResolvedFluxionOptions) {
  if (cluster.isPrimary) {
    console.error('createWorker should only be called in worker process');
    return;
  }
  (
    await Promise.all(
      options.injections.map(async (v) => {
        const instance = await v.factory();
        return { name: v.name, instance };
      }),
    )
  ).forEach((v) => Reflect.set(globalThis, v.name, v.instance));

  sendToPrimary({
    type: WorkerToPrimaryMessageType.Ready,
    pid: process.pid,
  });

  process.on('message', (rawMessage: unknown) => {
    if (!isFromPrimary(rawMessage)) {
      return;
    }

    console.log(`[worker ${process.pid}] received message`, rawMessage);
    if (rawMessage.type === PrimaryToWorkerMessageType.Ping) {
      sendToPrimary({
        type: WorkerToPrimaryMessageType.Pong,
        pid: process.pid,
        sentAt: rawMessage.sentAt,
        receivedAt: Date.now(),
      });
      return;
    }

    // todo 这里就解析url内容，找到文件来执行吧！
    const result = someTask(rawMessage.payload);
    sendToPrimary({
      type: WorkerToPrimaryMessageType.TaskResult,
      taskId: rawMessage.taskId,
      pid: process.pid,
      result,
    });
  });
}
