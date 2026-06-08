import type { FluxionContext, FluxionHandler } from './types.js';
import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { STATIC_CONTENT_TYPES } from '@/common/consts.js';
import { loadFunction } from '@/common/injector.js';

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
    const fullPath = path.isAbsolute(this.cx.options.dir)
      ? path.join(this.cx.options.dir, filepath)
      : path.join(process.cwd(), this.cx.options.dir, filepath);
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
   * File registration logic with fast-glob pattern matching:
   * 1. Check if the path exists, if not, delete the handler;
   * 2. If file doesn't match include patterns, skip registration;
   * 3. If file matches exclude patterns, skip registration;
   * 4. If file matches apiInclude patterns, register as API handler;
   * 5. Otherwise, register as static resource.
   * @param filepath
   */
  register(filepath: string) {
    const fullpath = path.isAbsolute(this.cx.options.dir)
      ? path.join(this.cx.options.dir, filepath)
      : path.join(process.cwd(), this.cx.options.dir, filepath);
    if (!fs.existsSync(fullpath)) {
      this.handlers.delete(filepath);
      this.cx.logger.info(`[${filepath}] deleted`);
      return;
    }

    delete require.cache[fullpath];

    // Step 2: Check if file matches include patterns (default: all files)
    // If not matching, skip registration
    const matchesInclude = this.cx.options.include.some((pattern) => minimatch(filepath, pattern));
    if (!matchesInclude) {
      this.handlers.delete(filepath);
      this.cx.logger.info(`[${filepath}] skipped (not in include)`);
      return;
    }

    // Step 3: Check if file matches exclude patterns
    // If matching, skip registration
    const matchesExclude = this.cx.options.exclude.some((pattern) => minimatch(filepath, pattern));
    if (matchesExclude) {
      this.handlers.delete(filepath);
      this.cx.logger.info(`[${filepath}] excluded`);
      return;
    }

    // Step 4 & 5: Check if file matches apiInclude patterns
    // If matching, register as API handler; otherwise as static resource
    const matchesApiInclude = this.cx.options.apiInclude.some((pattern) => minimatch(filepath, pattern));
    if (matchesApiInclude) {
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
