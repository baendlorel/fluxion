import type http from 'node:http';

import type { FileRouteSnapshot, FileWorkerSnapshot } from '@/workers/file-runtime.js';
import { sendJson } from './utils/send-json.js';
import type { NormalizedRequest } from './types.js';
import { META_PREFIX } from '@/common/consts.js';

interface CreateMetaApiOptions {
  /**
   * Same as `FluxionOptions.dir`.
   */
  dir: string;
  getRouteSnapshot: () => Promise<FileRouteSnapshot> | FileRouteSnapshot;
  getWorkerSnapshot: () => Promise<FileWorkerSnapshot> | FileWorkerSnapshot;
}

export function createMetaApi(options: CreateMetaApiOptions) {
  return {
    handleRequest: async (
      _req: http.IncomingMessage,
      res: http.ServerResponse,
      normalized: NormalizedRequest,
    ): Promise<boolean> => {
      const pathname = normalized.url.pathname;

      if (normalized.method === 'GET') {
        if (pathname === META_PREFIX + '/routes') {
          const routes = await options.getRouteSnapshot();
          sendJson(res, { routes });
          return true;
        }

        if (pathname === META_PREFIX + '/healthz') {
          sendJson(res, { ok: true, now: Date.now() });
          return true;
        }

        if (pathname === META_PREFIX + '/workers') {
          const workers = await options.getWorkerSnapshot();
          sendJson(res, { workers });
          return true;
        }
      }

      return false;
    },
  };
}
