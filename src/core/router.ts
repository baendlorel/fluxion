import type { FluxionLogger } from '@/common/logger.js';
import type { FluxionHandler } from './types.js';
import { STATIC_CONTENT_TYPES } from '@/common/consts.js';
import fs from 'node:fs';
import path from 'node:path';

export class FluxionRouter {
  private readonly handlers: Map<string, FluxionHandler> = new Map();
  private readonly dir: string;
  private readonly logger: FluxionLogger;

  constructor(options: { dir: string; logger: FluxionLogger }) {
    this.dir = options.dir;
    this.logger = options.logger;
  }

  makeStaticResource(filepath: string): FluxionHandler {
    const fullPath = path.join(this.dir, filepath);
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

      return new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(fullPath);
        stream.on('error', reject);
        stream.on('end', resolve);
        stream.pipe(res);
      });
    };
  }

  /**
   * 1. Check if the path exists, if not, delete the handler;
   * 2. If it's a ts file, register it as an API, otherwise return the file itself;
   * @param filepaths
   */
  register(filepaths: string[]) {
    for (let i = 0; i < filepaths.length; i++) {
      const filepath = filepaths[i];

      const p = path.join(this.dir, filepath);
      if (!fs.existsSync(p)) {
        this.handlers.delete(filepath);
        return;
      }

      delete require.cache[p];

      // register as api
      if (filepath.endsWith('.ts') || filepath.endsWith('.js')) {
        const handler = require(p);
        if (typeof handler === 'function') {
          this.handlers.set(filepath, handler);
        } else if (typeof handler.default === 'function') {
          this.handlers.set(filepath, handler.default);
        } else if (typeof handler.handler === 'function') {
          this.handlers.set(filepath, handler.handler);
        } else {
          this.logger.error(
            `Invalid handler module '${filepath}', make sure it has a default export or named export called "handler" which is a function`,
          );
        }
        continue;
      }

      // register as static resource
      this.handlers.set(filepath, this.makeStaticResource(filepath));
    }
  }

  getHandler(url: URL): FluxionHandler | undefined {
    const relativePath = url.pathname.replace(/^[\/]+/, '').replace(/[\/]+$/, '');
    return this.handlers.get(relativePath);
  }
}
