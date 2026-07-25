import type { FluxionContext, FluxionModuleWithType, FluxionRouteMeta } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { FluxionModuleType, STATIC_CONTENT_TYPES, STATIC_HANDLED_FLAG } from '@/common/consts.js';
import { loadFluxionModule } from '@/common/injector.js';
import { PromiseTry } from '@/common/promise-try.js';

export class FluxionRouter {
  private readonly cx: Pick<FluxionContext, 'options' | 'logger'>;
  private readonly handlers: Map<string, FluxionModuleWithType> = new Map();

  constructor(cx: Pick<FluxionContext, 'options' | 'logger'>) {
    this.cx = cx;
  }

  makeStaticResource(filepath: string): FluxionModuleWithType {
    return {
      type: FluxionModuleType.StaticResource,
      handler: async (normalized, _cx, req, res) => {
        if (normalized.method !== 'GET' && normalized.method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          res.end();
          return;
        }

        if (!fs.existsSync(filepath)) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        const stat = fs.statSync(filepath);
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
          const stream = fs.createReadStream(filepath);

          const cleanup = () => {
            stream.off('error', onError);
            stream.off('end', onEnd);
            res.off('close', onClientClose);
            req.off('aborted', onClientClose);
          };

          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };

          const onEnd = () => {
            cleanup();
            resolve(STATIC_HANDLED_FLAG);
          };

          const onClientClose = () => {
            cleanup();
            stream.destroy();
            resolve(STATIC_HANDLED_FLAG);
          };

          stream.on('error', onError);
          stream.on('end', onEnd);
          res.on('close', onClientClose);
          req.on('aborted', onClientClose);

          stream.pipe(res);
        });
      },
    };
  }

  async register(absolutePath: string, relativePath: string) {
    // Determine the path to use for handler lookup/deletion
    // For API files, this might be transformed by apiMapper
    const isApiFile = this.cx.options.apiInclude.some((pattern) => minimatch(relativePath, pattern));
    const handlerPath = isApiFile ? this.cx.options.apiMapper(relativePath) : relativePath;

    // Get the disposer and delete
    const disposer = this.handlers.get(handlerPath)?.disposer;
    if (disposer) {
      await PromiseTry(disposer);
    }

    // # Delete
    if (!fs.existsSync(absolutePath)) {
      this.handlers.delete(handlerPath);
      this.cx.logger.core({ action: 'Delete', url: handlerPath });
      return;
    }

    // Step 2: Check if file matches exclude patterns
    // If matching, skip registration
    const matchesExclude = this.cx.options.exclude.some((pattern) => minimatch(relativePath, pattern));
    if (matchesExclude) {
      this.handlers.delete(relativePath);
      this.cx.logger.core({ action: 'Exclude', url: relativePath });
      return;
    }

    // Step 3: Check if file matches apiInclude patterns
    // If matching, register as API handler
    const matchesApiInclude = this.cx.options.apiInclude.some((pattern) => minimatch(relativePath, pattern));
    if (matchesApiInclude) {
      const m = loadFluxionModule(this.cx, absolutePath);
      const apiPath = this.cx.options.apiMapper(relativePath);
      this.handlers.set(apiPath, m);
      this.cx.logger.core({ action: 'RegisterApi', url: apiPath });
      return;
    }

    // Step 4: Check if file matches staticInclude patterns
    // If matching, register as static resource
    const matchesStaticInclude = this.cx.options.staticInclude.some((pattern) => minimatch(relativePath, pattern));
    if (matchesStaticInclude) {
      this.handlers.set(relativePath, this.makeStaticResource(absolutePath));
      this.cx.logger.core({ action: 'RegisterStatic', url: relativePath });
      return;
    }

    // Step 5: File doesn't match any pattern, skip registration
    this.handlers.delete(handlerPath);
    this.cx.logger.core({ action: 'Skip', url: handlerPath });
  }

  getModule(url: URL): FluxionModuleWithType | undefined {
    const relativePath = url.pathname.replace(/^[/]+/, '').replace(/[/]+$/, '');
    return this.handlers.get(relativePath);
  }

  getRoutes(): FluxionRouteMeta[] {
    return [...this.handlers.entries()]
      .map(
        ([relativePath, m]): FluxionRouteMeta => ({
          path: '/' + relativePath,
          type: m.type === FluxionModuleType.Api ? 'api' : 'static',
          methods: m.methods ? [...m.methods] : null,
        }),
      )
      .sort((a, b) => a.path.localeCompare(b.path));
  }
}
