import http from 'node:http';
import path from 'node:path';
import cluster from 'node:cluster';
import fs from 'node:fs';
import type { FluxionHandler, NormalizedFluxionOptions } from '../types.js';

const parsePathname = (dir: string, pathname: string) => {
  const parts = pathname.split('/');
  if (parts.length === 0) {
    $throw(`Invalid pathname: ${pathname}`);
  }

  parts[0] = dir;
  const name = parts.at(-1) as string;
  return { rawPath: path.join(...parts), filename: name };
};

/**
 * ! Make sure `fullpath` exists before calling this function
 */
const importHandler = async (fullpath: string, stat?: fs.Stats): Promise<FluxionHandler> => {
  stat ??= fs.statSync(fullpath);
  const o = await import(`${fullpath}:${stat.mtimeMs}`);

  if (typeof o.default === 'function') {
    return o.default as FluxionHandler;
  }
  if (typeof o.handler === 'function') {
    return o.handler as FluxionHandler;
  }

  $throw(
    `Invalid JS Module '${fullpath}', make sure it has a default export or named export called "handler" which is a function`,
  );
};

const replyStaticResources = <
  Request extends typeof http.IncomingMessage = typeof http.IncomingMessage,
  Response extends typeof http.ServerResponse = typeof http.ServerResponse,
>(
  req: InstanceType<Request>,
  res: InstanceType<Response> & { req: InstanceType<Request> },
  fullpath: string,
  filename?: string,
): any => {
  filename ??= path.basename(fullpath);
  // todo 流式返回静态资源文件，可能是html、css、js、图片等
};

const findFromMjs = (fullpath: string): Promise<FluxionHandler> => {
  const stat = fs.statSync(fullpath);
  if (!stat.isFile()) {
    $throw(`${path.dirname(fullpath)} is not a file`);
  }
  return importHandler(fullpath);
};

export async function findHandler(options: NormalizedFluxionOptions, url: URL): Promise<FluxionHandler> {
  if (cluster.isPrimary) {
    $throw('createFileRuntime should only be called in worker process');
  }
  const { rawPath, filename } = parsePathname(options.dir, url.pathname);

  if (fs.existsSync(rawPath)) {
    const stat = fs.statSync(rawPath);
    if (stat.isFile()) {
      if (/\.mjs/i.test(filename)) {
        return importHandler(rawPath, stat);
      } else {
        return (req, res) => replyStaticResources(req, res, rawPath);
      }
    }

    if (stat.isDirectory()) {
      const mjsPath = path.join(rawPath, 'index.mjs');
      if (fs.existsSync(mjsPath)) {
        return findFromMjs(mjsPath);
      }

      const htmlPath = path.join(rawPath, 'index.html');
      if (fs.existsSync(htmlPath)) {
        return (req, res) => replyStaticResources(req, res, htmlPath, 'index.html');
      }

      $throw(`${filename} is a directory, but has no valid index.mjs/index.html inside`);
    }

    $throw(`${filename} is not a file nor a directory`);
  }

  const rawPathMjs = rawPath + '.mjs';
  if (fs.existsSync(rawPathMjs)) {
    return findFromMjs(rawPathMjs);
  }

  const rawPathHtml = rawPath + '.html';
  if (fs.existsSync(rawPathHtml)) {
    return (req, res) => replyStaticResources(req, res, rawPathHtml);
  }

  $throw('Not Found');
}
