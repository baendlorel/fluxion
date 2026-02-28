import http from 'node:http';

import { DUMMY_BASE_URL } from '@/common/consts.js';
import type { FileRouteSnapshot } from './file-runtime.js';
import { sendJson } from './utils/send-json.js';

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

function getPathname(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl, DUMMY_BASE_URL).pathname;
  } catch {
    return undefined;
  }
}

export function createMetaApi(options: CreateMetaApiOptions): MetaApi {
  const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    const rawUrl = req.url;

    if (rawUrl === undefined) {
      return false;
    }

    const method = req.method ?? 'GET';
    const pathname = getPathname(rawUrl);

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
