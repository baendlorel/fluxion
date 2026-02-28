import http from 'node:http';

import type { FileRouteSnapshot } from './file-runtime.js';
import { sendJson } from './utils/send-json.js';
import { toURL } from './utils/request.js';

const META_PREFIX = '/_fluxion';
const ROUTES_PATH = META_PREFIX + '/routes';
const HEALTHZ_PATH = META_PREFIX + '/healthz';

interface CreateMetaApiOptions {
  dynamicDirectory: string;
  getRouteSnapshot: () => Promise<FileRouteSnapshot> | FileRouteSnapshot;
  onArchiveInstalled?: () => void;
}

interface MetaApi {
  handleRequest: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>;
}

export function createMetaApi(options: CreateMetaApiOptions): MetaApi {
  const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    const rawUrl = req.url;

    if (rawUrl === undefined) {
      return false;
    }

    const method = req.method ?? 'GET';
    const pathname = toURL(rawUrl)?.pathname;

    if (pathname === undefined) {
      return false;
    }

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
  };

  return {
    handleRequest,
  };
}
