import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

import type { BodyPreview, FluxionOptions } from '@/types/server.js';
import { HttpCode } from '@/common/consts.js';
import { getErrorMessage, log, logJsonl } from '@/common/logger.js';

import { createFileRuntime } from './file-runtime.js';
import { createMetaApi } from './meta-api.js';

import { safeSendJson } from './utils/send-json.js';
import { getRealIp, isTextualContentType } from './utils/headers.js';
import { parseRequestTarget } from './utils/request.js';

export function ensureDynamicDirectory(dynamicDirectory: string): void {
  if (fs.existsSync(dynamicDirectory)) {
    return;
  }

  fs.mkdirSync(dynamicDirectory, { recursive: true });
  logJsonl('INFO', 'dynamic_directory_created', {
    directory: dynamicDirectory,
  });
}

function createBodyPreviewCapture(req: http.IncomingMessage, maxBytes = 8192): { getPreview: () => BodyPreview } {
  const originalPush = req.push.bind(req);
  const chunks: Buffer[] = [];
  let previewBytes = 0;
  let totalBytes = 0;
  let truncated = false;
  let restored = false;

  const restorePush = (): void => {
    if (restored) {
      return;
    }

    req.push = originalPush;
    restored = true;
  };

  req.push = ((chunk: unknown, encoding?: BufferEncoding): boolean => {
    if (chunk !== null && chunk !== undefined) {
      let bufferChunk: Buffer;

      if (Buffer.isBuffer(chunk)) {
        bufferChunk = chunk;
      } else if (typeof chunk === 'string') {
        bufferChunk = Buffer.from(chunk, encoding);
      } else if (ArrayBuffer.isView(chunk)) {
        bufferChunk = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      } else {
        bufferChunk = Buffer.from(String(chunk));
      }

      totalBytes += bufferChunk.length;

      if (previewBytes < maxBytes) {
        const remaining = maxBytes - previewBytes;
        const nextSlice = bufferChunk.subarray(0, remaining);
        chunks.push(nextSlice);
        previewBytes += nextSlice.length;

        if (bufferChunk.length > remaining) {
          truncated = true;
        }
      } else {
        truncated = true;
      }
    }

    return originalPush(chunk as never, encoding);
  }) as typeof req.push;

  req.once('end', restorePush);
  req.once('close', restorePush);

  const getPreview = (): BodyPreview => {
    const contentLength = req.headers['content-length'];
    const declaredBytes = contentLength ? Number.parseInt(contentLength, 10) : NaN;
    const hasDeclaredBody = Number.isFinite(declaredBytes) && declaredBytes > 0;
    const hasCapturedBody = totalBytes > 0;
    const hasBody = hasDeclaredBody || hasCapturedBody;
    const effectiveBytes = hasCapturedBody ? totalBytes : hasDeclaredBody ? declaredBytes : 0;

    if (!hasBody) {
      return {
        exists: false,
        bytes: 0,
        truncated: false,
      };
    }

    const contentType = req.headers['content-type'];
    const bodyBuffer = Buffer.concat(chunks);

    if (isTextualContentType(contentType)) {
      return {
        exists: true,
        value: bodyBuffer.toString('utf8'),
        bytes: effectiveBytes,
        truncated: truncated || (hasDeclaredBody && declaredBytes > bodyBuffer.length),
      };
    }

    return {
      exists: true,
      value: `<binary body: ${effectiveBytes} bytes>`,
      bytes: effectiveBytes,
      truncated: truncated || (hasDeclaredBody && declaredBytes > bodyBuffer.length),
    };
  };

  return { getPreview };
}

export function startServer(options: FluxionOptions): http.Server {
  const dynamicDirectory = path.resolve(options.dir);
  if (!fs.existsSync(dynamicDirectory)) {
    fs.mkdirSync(dynamicDirectory, { recursive: true });
    logJsonl('INFO', 'dynamic_directory_created', { directory: dynamicDirectory });
  }

  const fileRuntime = createFileRuntime(dynamicDirectory);
  const metaApi = createMetaApi({
    dynamicDirectory,
    getRouteSnapshot: () => fileRuntime.getRouteSnapshot(),
    onArchiveInstalled: () => {
      fileRuntime.clearCache();
    },
  });

  void fileRuntime
    .getRouteSnapshot()
    .then((snapshot) => {
      const handlerCount = snapshot.handlers.length;
      const staticFileCount = snapshot.staticFiles.length;

      logJsonl('INFO', 'dynamic_directory_loaded', {
        dynamicDirectory,
        handlerCount,
        staticFileCount,
      });

      if (handlerCount === 0) {
        log('INFO', 'Loaded handler(s): none');
        return;
      }

      for (let i = 0; i < snapshot.handlers.length; i++) {
        const handler = snapshot.handlers[i];
        log('INFO', `Loaded handler: ${handler.route} (${handler.file})`);
      }
    })
    .catch((error) => {
      logJsonl('ERROR', 'dynamic_directory_load_failed', {
        dynamicDirectory,
        error: getErrorMessage(error),
      });
    });

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const realIp = getRealIp(req);
    const requestUrl = req.url ?? undefined;
    const requestTarget = parseRequestTarget(requestUrl);
    const bodyCapture = createBodyPreviewCapture(req);

    log('INFO', `Request ${method} ${requestTarget.path} from ${realIp}`);
    logJsonl('INFO', 'request_received', {
      method,
      ip: realIp,
      url: requestUrl ?? null,
      path: requestTarget.path,
    });

    res.once('finish', () => {
      const fields: Record<string, unknown> = {
        method,
        ip: realIp,
        url: requestUrl ?? null,
        path: requestTarget.path,
        statusCode: res.statusCode,
      };

      if (Object.keys(requestTarget.query).length > 0) {
        fields.query = requestTarget.query;
      }

      const bodyPreview = bodyCapture.getPreview();
      if (bodyPreview.exists) {
        fields.body = bodyPreview.value;
        fields.bodyBytes = bodyPreview.bytes;
        fields.bodyTruncated = bodyPreview.truncated;
      }

      logJsonl('INFO', 'request_completed', fields);
    });

    if (req.url === undefined) {
      safeSendJson(res, HttpCode.BAD_REQUEST, { message: 'Bad Request: req.url is undefined' });
      return;
    }

    void metaApi
      .handleRequest(req, res)
      .then(async (metaHandled) => {
        if (metaHandled) {
          return;
        }

        const runtimeResult = await fileRuntime.handleRequest(req, res);

        if (runtimeResult === 'not_found') {
          safeSendJson(res, 404, {
            message: 'Route not found',
            method: req.method ?? 'GET',
            url: req.url ?? null,
          });
        }
      })
      .catch((error) => {
        logJsonl('ERROR', 'request_failed', {
          method: req.method ?? 'GET',
          url: req.url ?? null,
          error: getErrorMessage(error),
        });

        safeSendJson(res, 500, { message: 'Internal Server Error' });
      });
  });

  server.on('close', () => {
    log('INFO', `Server closed at http://${options.host}:${options.port}`);
  });

  server.listen(options.port, options.host, () => {
    log('INFO', `Server started at http://${options.host}:${options.port}`);
    log('INFO', `Dynamic directory: ${dynamicDirectory}`);
  });

  return server;
}
