import { FluxionModuleType, STATIC_CONTENT_TYPES, STATIC_HANDLED_FLAG } from '@/common/consts.js';
import type { FluxionContext, NormalizedModule, FluxionRouteMeta } from '../types.js';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

export abstract class FluxionRouterBase {
  protected readonly cx: Pick<FluxionContext, 'options' | 'logger'>;
  protected readonly handlers: Map<string, NormalizedModule> = new Map();

  constructor(cx: Pick<FluxionContext, 'options' | 'logger'>) {
    this.cx = cx;
  }

  protected makeStaticResource(absolutePath: string): NormalizedModule {
    return {
      type: FluxionModuleType.StaticResource,
      path: absolutePath,
      handler: async (normalized, _cx, req, res) => {
        if (normalized.method !== 'GET' && normalized.method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          res.end();
          return;
        }

        if (!existsSync(absolutePath)) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        const stat = statSync(absolutePath);
        if (!stat.isFile()) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        const extension = path.extname(absolutePath).toLowerCase();
        const contentType = STATIC_CONTENT_TYPES[extension] ?? 'application/octet-stream';

        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', String(stat.size));

        if (normalized.method === 'HEAD') {
          res.end();
          return;
        }

        return new Promise<symbol>((resolve, reject) => {
          const stream = createReadStream(absolutePath);

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

  abstract register(absolutePath: string, relativePath: string): Promise<void>;

  abstract getModule(url: URL): NormalizedModule | undefined;

  abstract getRoutes(): FluxionRouteMeta[];
}
