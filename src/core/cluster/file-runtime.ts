import http from 'node:http';
import path from 'node:path';
import cluster from 'node:cluster';
import fs from 'node:fs';
import type { FluxionHandler, NormalizedFluxionOptions } from '../types.js';

const parsePathname = (dir: string, pathname: string) => {
  const parts = pathname.split('/');
  parts[0] = dir;
  const name = parts.at(-1) as string;
  return { mjs: path.join(...parts), indexMjs: path.join(...parts, 'index.mjs'), filename: name };
};

/**
 * ! Make sure `fullpath` exists before calling this function
 */
const importHandler = async (
  options: NormalizedFluxionOptions,
  fullpath: string,
  stat: fs.Stats,
): Promise<FluxionHandler | undefined> => {
  const o = await import(`${fullpath}:${stat.mtimeMs}`);
  if (Error.isError(o)) {
    // todo 删除这里让它报错
    // & Make it silent
    options.logger.error('ImportHandlerFailed ' + o.message + '\n' + o.stack);
    return undefined;
  }

  if (typeof o.default === 'function') {
    return o.default as FluxionHandler;
  }
  if (typeof o.handler === 'function') {
    return o.handler as FluxionHandler;
  }

  return undefined;
};

const replyStaticResources = <
  Request extends typeof http.IncomingMessage = typeof http.IncomingMessage,
  Response extends typeof http.ServerResponse = typeof http.ServerResponse,
>(
  req: InstanceType<Request>,
  res: InstanceType<Response> & { req: InstanceType<Request> },
  fullpath: string,
  filename: string,
): any => {
  // todo 流式返回静态资源文件，可能是html、css、js、图片等
};

export async function findHandler(options: NormalizedFluxionOptions, url: URL): Promise<FluxionHandler | string> {
  if (cluster.isPrimary) {
    $throw('createFileRuntime should only be called in worker process');
  }

  const rawPath = path.join(options.dir, url.pathname);
  const { mjs, indexMjs, filename } = parsePathname(options.dir, url.pathname);

  if (fs.existsSync(rawPath)) {
    const stat = fs.statSync(rawPath);
    if (stat.isDirectory()) {
      const rawPathAsIndexMjs = path.join(rawPath, 'index.mjs');
      if (fs.existsSync(rawPathAsIndexMjs)) {
        const handler = await importHandler(options, rawPathAsIndexMjs);
        if (handler) {
          return handler;
        }
      }

      const rawPathAsIndexHtml = path.join(rawPath, 'index.html');
      if (fs.existsSync(rawPathAsIndexHtml)) {
        return (req, res) => replyStaticResources(req, res, rawPathAsIndexHtml, 'index.html');
      }

      return `${filename} is a directory, but has no valid index.mjs handler inside`;
    }

    if (stat.isFile()) {
      if (/\.mjs/i.test(rawPath)) {
        const handler = await importHandler(options, rawPath, stat);
        if (handler) {
          return handler;
        }
      }
      return (req, res) => replyStaticResources(req, res, rawPath, 'index.html');
    }
    return `${filename} is not a file nor a directory`;
  }

  const rawPathMjs = rawPath + '.mjs';
  if (fs.existsSync(rawPathMjs)) {
    const stat = fs.statSync(rawPathMjs);
    if (!stat.isFile()) {
      return `${filename}.mjs is not a file`;
    }
    const handler = await importHandler(options, mjs);
    if (handler) {
      return handler;
    }
    return `${filename}.mjs has no valid handler export`;
  }

  return undefined;
}
