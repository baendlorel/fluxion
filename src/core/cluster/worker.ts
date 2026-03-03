import cluster from 'node:cluster';
import { ResolvedFluxionOptions } from '../types.js';
import { ToPrimaryMessage, ToWorkerMessage } from './types.js';
import { ToPrimaryMessageType, ToWorkerMessageType, isToWorker } from './consts.js';

const sendToPrimary = (message: ToPrimaryMessage) => process.send?.(message);

async function createWorkerPrimarySide(options: ResolvedFluxionOptions) {}

async function createWorkerChildSide(options: ResolvedFluxionOptions) {
  (
    await Promise.all(
      options.injections.map(async (v) => {
        const instance = await v.factory();
        return { name: v.name, instance };
      }),
    )
  ).forEach((v) => Reflect.set(globalThis, v.name, v.instance));

  sendToPrimary({
    type: ToPrimaryMessageType.Ready,
    pid: process.pid,
  });

  process.on('message', (rawMessage: ToWorkerMessage) => {
    if (!isToWorker(rawMessage)) {
      return;
    }

    console.log(`[worker ${process.pid}] received message`, rawMessage);
    if (rawMessage.type === ToWorkerMessageType.Ping) {
      sendToPrimary({
        type: ToPrimaryMessageType.Pong,
        pid: process.pid,
        sentAt: rawMessage.sentAt,
        receivedAt: Date.now(),
      });
      return;
    }

    // todo 这里就解析url内容，找到文件来执行吧！
    const result = someTask(rawMessage.payload);
    sendToPrimary({
      type: ToPrimaryMessageType.TaskResult,
      taskId: rawMessage.taskId,
      pid: process.pid,
      result,
    });
  });
}

export async function createWorker(options: ResolvedFluxionOptions) {
  if (cluster.isPrimary) {
    return createWorkerPrimarySide(options);
  } else {
    return createWorkerChildSide(options);
  }
}
