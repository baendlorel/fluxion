import type { FluxionContext, FluxionHandler } from './types.js';
import { STATIC_CONTENT_TYPES } from '@/common/consts.js';
import { loadFunction } from '@/common/injector.js';
import fs from 'node:fs';
import path from 'node:path';

export class FluxionRouter {
  /**
   * This means the request has been handled by static resource handler, and no more response should be sent.
   */
  public readonly StaticHandled = Symbol.for('fluxion.router.StaticHandled');

  private readonly cx: Pick<FluxionContext, 'options' | 'logger'>;
  private readonly handlers: Map<string, FluxionHandler> = new Map();

  constructor(cx: Pick<FluxionContext, 'options' | 'logger'>) {
    this.cx = cx;
  }

  makeStaticResource(filepath: string): FluxionHandler {
    const fullPath = path.join(this.cx.options.dir, filepath);
    return async (normalized, _req, res) => {
      if (normalized.method !== 'GET' && normalized.method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET, HEAD');
        res.end();
        return;
      }

      if (!fs.existsSync(fullPath)) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      const extension = path.extname(filepath).toLowerCase();
      const contentType = STATIC_CONTENT_TYPES[extension] ?? 'application/octet-stream';

      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(stat.size));

      if (normalized.method === 'HEAD') {
        res.end();
        return;
      }

      return new Promise<symbol>((resolve, reject) => {
        const stream = fs.createReadStream(fullPath);
        stream.on('error', reject);
        stream.on('end', () => resolve(this.StaticHandled));
        stream.pipe(res);
      });
    };
  }

  /**
   * 1. Check if the path exists, if not, delete the handler;
   * 2. If the file extension matches `routerExclude`, delete it and return early;
   * 3. If the file extension matches `apiExts`, register it as an API, otherwise register as static resource;
   * @param filepath
   */
  register(filepath: string) {
    const fullpath = path.join(process.cwd(), this.cx.options.dir, filepath);
    if (!fs.existsSync(fullpath)) {
      this.handlers.delete(filepath);
      this.cx.logger.info(`[${filepath}] deleted`);
      return;
    }

    delete require.cache[fullpath];

    const extension = path.extname(filepath).toLowerCase();

    // Check if this file should be excluded from registration
    if (this.cx.options.routerExclude.some((ext) => extension === ext)) {
      this.handlers.delete(filepath);
      this.cx.logger.info(`[${filepath}] excluded`);
      return;
    }

    // register as api
    // ! Files with extensions matching `apiExts` are considered as API handlers.
    if (this.cx.options.apiExts.some((ext) => extension === ext)) {
      const handler = loadFunction({ name: fullpath, modulePath: fullpath });
      this.handlers.set(filepath, handler);
      this.cx.logger.info(`[${filepath}] handler registered`);
      return;
    }

    // register as static resource
    this.handlers.set(filepath, this.makeStaticResource(filepath));
    this.cx.logger.info(`[${filepath}] static resource registered`);
  }

  getHandler(url: URL): FluxionHandler | undefined {
    const relativePath = url.pathname.replace(/^[\/]+/, '').replace(/[\/]+$/, '');
    return this.handlers.get(relativePath);
  }
}
