import type http from 'node:http';

import type { NormalizedRequest } from '../types.js';
import { META_PREFIX } from '@/common/consts.js';
import { sendJson } from '../utils/respond.js';

export function createMetaApiHandler() {
  return async (
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    normalized: NormalizedRequest,
  ): Promise<boolean> => {
    const pathname = normalized.url.pathname;

    if (normalized.method === 'GET') {
      if (pathname === META_PREFIX + '/healthz') {
        sendJson(res, { ok: true, now: Date.now() });
        return true;
      }

      // if (pathname === META_PREFIX + '/routes') {
      //   const routes = await options.getRouteSnapshot();
      //   sendJson(res, { routes });
      //   return true;
      // }
      // if (pathname === META_PREFIX + '/workers') {
      //   const workers = await options.getWorkerSnapshot();
      //   sendJson(res, { workers });
      //   return true;
      // }
    }

    return false;
  };
}
