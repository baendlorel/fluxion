import http from 'node:http';

import type { FileRouteSnapshot } from './file-runtime.js';
import { sendJson } from './utils/send-json.js';
import { toURL } from './utils/request.js';
import { NormalizedRequest } from './types.js';

const META_PREFIX = '/_fluxion';
const ROUTES_PATH = META_PREFIX + '/routes';
const HEALTHZ_PATH = META_PREFIX + '/healthz';

interface CreateMetaApiOptions {
  /**
   * Same as `FluxionOptions.dir`.
   */
  dir: string;
  getRouteSnapshot: () => Promise<FileRouteSnapshot> | FileRouteSnapshot;
  onArchiveInstalled?: () => void;
}

interface MetaApi {
  handleRequest: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    normalized: NormalizedRequest,
  ) => Promise<boolean>;
}

export function createMetaApi(options: CreateMetaApiOptions): MetaApi {
  return {
    handleRequest: async (
      _req: http.IncomingMessage,
      res: http.ServerResponse,
      normalized: NormalizedRequest,
    ): Promise<boolean> => {
      const method = normalized.method;
      const pathname = normalized.url.pathname;

      if (method === 'GET' && pathname === ROUTES_PATH) {
        const routes = await options.getRouteSnapshot();
        sendJson(res, 200, { routes });
        return true;
      }

      if (method === 'GET' && pathname === HEALTHZ_PATH) {
        sendJson(res, 200, {
          ok: true,
          now: Date.now(),
        });
        return true;
      }

      return false;
    },
  };
}
