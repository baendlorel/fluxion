import type { FluxionContext, FluxionHandler } from './types.js';
import { STATIC_CONTENT_TYPES } from '@/common/consts.js';
import fs from 'node:fs';
import path from 'node:path';

export class FluxionRouter {
  public static readonly StaticHandled = Symbol('staticHandled');

  private readonly handlers: Map<string, FluxionHandler> = new Map();
  private readonly cx: Pick<FluxionContext, 'options' | 'logger'>;

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
        stream.on('end', () => resolve(FluxionRouter.StaticHandled));
        stream.pipe(res);
      });
    };
  }

  /**
   * 1. Check if the path exists, if not, delete the handler;
   * 2. If it's a ts file, register it as an API, otherwise return the file itself;
   * @param filepath
   */
  register(filepath: string) {
    const p = path.join(this.cx.options.dir, filepath);
    if (!fs.existsSync(p)) {
      this.handlers.delete(filepath);
      return;
    }

    delete require.cache[p];

    // register as api
    // ! Only ts files are considered as API handlers, because js files might be used by dom.
    if (filepath.endsWith('.ts')) {
      const handler = require(p);
      if (typeof handler === 'function') {
        this.handlers.set(filepath, handler);
      } else if (typeof handler.default === 'function') {
        this.handlers.set(filepath, handler.default);
      } else if (typeof handler.handler === 'function') {
        this.handlers.set(filepath, handler.handler);
      } else {
        this.cx.logger.error(
          `Invalid handler module '${filepath}', make sure it has a default export or named export called "handler" which is a function`,
        );
      }
      return;
    }

    // register as static resource
    this.handlers.set(filepath, this.makeStaticResource(filepath));
  }

  getHandler(url: URL): FluxionHandler | undefined {
    const relativePath = url.pathname.replace(/^[\/]+/, '').replace(/[\/]+$/, '');
    return this.handlers.get(relativePath);
  }
}
