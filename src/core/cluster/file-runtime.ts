import cluster from 'node:cluster';
import type { FluxionHandler } from '../types.js';
import type { RunTaskMessage } from './types.js';
import { ToPrimaryType, ToWorkerType } from './consts.js';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';

const loadHandler = async (fullpath: string): Promise<FluxionHandler> => {
  if (!existsSync(fullpath)) {
    $throw(`Handler file not found: ${fullpath}`);
  }

  const stat = statSync(fullpath);
  const o = await import(`${fullpath}:${stat.mtimeMs}`);

  if (typeof o.default === 'function') {
    return o.default as FluxionHandler;
  }
  if (typeof o.handler === 'function') {
    return o.handler as FluxionHandler;
  }

  $throw(`Handler file does not 'export default function' nor contain a 'handler' function. path: ${fullpath}`);
};

const parsePathname = (pathname: string) => {
  const parts = pathname.split('/');
  parts[0] = fluxionOptions.dir;
  const name = parts.at(-1) as string;

  return { mjs: path.join(...parts), indexMjs: path.join(...parts, 'index.mjs'), filename: name };
};

const sendToPrimary = (o: any) => process.send?.(o);

export function createFileRuntime() {
  if (cluster.isPrimary) {
    $throw('createFileRuntime should only be called in worker process');
  }

  process.on('message', async (args: RunTaskMessage) => {
    if (args.type !== ToWorkerType.RunTask) {
      return;
    }

    console.log(`[worker ${process.pid}] received task(id:${args.taskId})`);
    const taskId = args.taskId;
    const { mjs, indexMjs, filename } = parsePathname(args.pathname);

    // todo 直接查找mjs文件
    if (mjs.endsWith('.mjs')) {
      const handler = await loadHandler(mjs);
      const result = await handler(args.payload);
      sendToPrimary({
        type: ToPrimaryType.TaskResult,
        taskId,
        result,
      });
      return;
    }
  });
  return;
}
