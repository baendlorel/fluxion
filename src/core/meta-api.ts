import http from 'node:http';

import { getErrorMessage, logJsonLine } from '../common/logger.js';
import { installModuleArchive, ArchiveValidationError } from './archive-installer.js';
import type { ModuleRouteSnapshot } from './router.js';
import { sendJson } from './response.js';

const META_PREFIX = '/_fluxion';
const ROUTES_PATH = META_PREFIX + '/routes';
const UPLOAD_PATH = META_PREFIX + '/upload';
const HEALTHZ_PATH = META_PREFIX + '/healthz';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface CreateMetaApiOptions {
  dynamicDirectory: string;
  getRouteSnapshot: () => ModuleRouteSnapshot;
  syncModules: () => void;
}

interface MetaApi {
  handleRequest: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>;
}

function getPathname(rawUrl: string): string {
  return new URL(rawUrl, 'http://fluxion.local').pathname;
}

function getUploadFilename(req: http.IncomingMessage): string | undefined {
  const url = req.url;

  if (url !== undefined) {
    const parsed = new URL(url, 'http://fluxion.local');
    const fromQuery = parsed.searchParams.get('filename');

    if (fromQuery !== null && fromQuery.trim().length > 0) {
      return fromQuery;
    }
  }

  const fromHeader = req.headers['x-fluxion-filename'];

  if (typeof fromHeader === 'string' && fromHeader.trim().length > 0) {
    return fromHeader;
  }

  if (Array.isArray(fromHeader) && fromHeader.length > 0) {
    const first = fromHeader[0];
    if (typeof first === 'string' && first.trim().length > 0) {
      return first;
    }
  }

  return undefined;
}

async function readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bufferChunk.length;

    if (totalBytes > maxBytes) {
      throw new Error(`Payload too large (>${maxBytes} bytes)`);
    }

    chunks.push(bufferChunk);
  }

  return Buffer.concat(chunks);
}

export function createMetaApi(options: CreateMetaApiOptions): MetaApi {
  const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    const rawUrl = req.url;

    if (rawUrl === undefined) {
      return false;
    }

    const method = req.method ?? 'GET';
    const pathname = getPathname(rawUrl);

    if (method === 'GET' && pathname === ROUTES_PATH) {
      sendJson(res, 200, {
        routes: options.getRouteSnapshot(),
      });
      return true;
    }

    if (method === 'GET' && pathname === HEALTHZ_PATH) {
      sendJson(res, 200, {
        ok: true,
        now: Date.now(),
      });
      return true;
    }

    if (method === 'POST' && pathname === UPLOAD_PATH) {
      const archiveFilename = getUploadFilename(req);

      if (archiveFilename === undefined) {
        sendJson(res, 400, {
          message: 'Missing archive filename. Provide ?filename=... or x-fluxion-filename header (.tar, .tar.gz, .tgz)',
        });
        return true;
      }

      try {
        const archiveBuffer = await readRequestBody(req, MAX_UPLOAD_BYTES);

        if (archiveBuffer.length === 0) {
          sendJson(res, 400, {
            message: 'Upload body is empty',
          });
          return true;
        }

        const installResult = await installModuleArchive({
          archiveBuffer,
          archiveFilename,
          dynamicDirectory: options.dynamicDirectory,
        });

        options.syncModules();

        sendJson(res, 200, {
          message: 'Module uploaded',
          module: installResult.moduleName,
          layout: installResult.layout,
          installedPath: installResult.installedPath,
        });

        return true;
      } catch (error) {
        if (error instanceof ArchiveValidationError) {
          sendJson(res, 400, {
            message: error.message,
          });
          return true;
        }

        const errorMessage = getErrorMessage(error);
        const statusCode = errorMessage.includes('Payload too large') ? 413 : 500;

        if (statusCode === 500) {
          logJsonLine('ERROR', 'meta_upload_failed', {
            filename: archiveFilename,
            error: errorMessage,
          });
        }

        sendJson(res, statusCode, {
          message: statusCode === 413 ? 'Payload too large' : 'Failed to upload module archive',
          error: errorMessage,
        });

        return true;
      }
    }

    return false;
  };

  return {
    handleRequest,
  };
}
