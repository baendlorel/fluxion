import type http from 'node:http';

import { isTextualContentType } from './headers.js';
import { parseQuery } from './query.js';

export interface BodyPreview {
  exists: boolean;
  value?: string;
  bytes: number;
  truncated: boolean;
}

function createRequestBodyTooLargeError(receivedBytes: number, maxBytes: number): NodeJS.ErrnoException {
  const sizeError = new Error(
    `request body too large: ${receivedBytes.toString()} bytes exceeds ${maxBytes.toString()} bytes`,
  ) as NodeJS.ErrnoException;

  sizeError.code = 'REQUEST_BODY_TOO_LARGE';

  return sizeError;
}

function getHeaderValue(headerValue: string | string[] | undefined): string | undefined {
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

function createEmptyPreview(): BodyPreview {
  return {
    exists: false,
    bytes: 0,
    truncated: false,
  };
}

function createPreview(
  previewBuffer: Buffer,
  totalBytes: number,
  contentType: string | undefined,
  truncated: boolean,
): BodyPreview {
  if (totalBytes === 0) {
    return createEmptyPreview();
  }

  if (isTextualContentType(contentType)) {
    return {
      exists: true,
      value: previewBuffer.toString('utf8'),
      bytes: totalBytes,
      truncated,
    };
  }

  return {
    exists: true,
    value: `<binary body: ${totalBytes} bytes>`,
    bytes: totalBytes,
    truncated,
  };
}

async function readRequestBodyWithPreview(
  req: http.IncomingMessage,
  method: string,
  maxBytes: number,
  previewMaxBytes = 8192,
): Promise<{ rawBody: Buffer | undefined; preview: BodyPreview }> {
  if (method === 'GET' || method === 'HEAD') {
    return {
      rawBody: undefined,
      preview: createEmptyPreview(),
    };
  }

  if (req.readableEnded) {
    return {
      rawBody: undefined,
      preview: createEmptyPreview(),
    };
  }

  const contentLengthRaw = getHeaderValue(req.headers['content-length']);
  const declaredBytes = contentLengthRaw !== undefined ? Number.parseInt(contentLengthRaw, 10) : NaN;

  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw createRequestBodyTooLargeError(declaredBytes, maxBytes);
  }

  return new Promise((resolve, reject) => {
    const rawBodyChunks: Buffer[] = [];
    const previewChunks: Buffer[] = [];
    let totalBytes = 0;
    let previewBytes = 0;
    let previewTruncated = false;
    let settled = false;

    const cleanup = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
    };

    const settle = (action: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      action();
    };

    const onData = (chunk: Buffer | string | Uint8Array): void => {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bufferChunk.byteLength;

      if (totalBytes > maxBytes) {
        cleanup();
        req.resume();
        settle(() => {
          reject(createRequestBodyTooLargeError(totalBytes, maxBytes));
        });
        return;
      }

      rawBodyChunks.push(bufferChunk);

      if (previewBytes < previewMaxBytes) {
        const remaining = previewMaxBytes - previewBytes;
        const nextSlice = bufferChunk.subarray(0, remaining);
        previewChunks.push(nextSlice);
        previewBytes += nextSlice.length;

        if (nextSlice.length < bufferChunk.length) {
          previewTruncated = true;
        }
      } else {
        previewTruncated = true;
      }
    };

    const onEnd = (): void => {
      cleanup();
      settle(() => {
        const rawBody = rawBodyChunks.length > 0 ? Buffer.concat(rawBodyChunks) : undefined;
        const previewBuffer = previewChunks.length > 0 ? Buffer.concat(previewChunks) : Buffer.alloc(0);

        resolve({
          rawBody,
          preview: createPreview(
            previewBuffer,
            rawBody?.byteLength ?? 0,
            getHeaderValue(req.headers['content-type']),
            previewTruncated,
          ),
        });
      });
    };

    const onError = (error: Error): void => {
      cleanup();
      settle(() => {
        reject(error);
      });
    };

    const onAborted = (): void => {
      cleanup();
      settle(() => {
        reject(new Error('request aborted while reading body'));
      });
    };

    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
  });
}

export async function parseBody(
  req: http.IncomingMessage,
  method: string,
  maxBytes: number,
): Promise<{ body: Record<string, any>; preview: BodyPreview }> {
  const { rawBody, preview } = await readRequestBodyWithPreview(req, method, maxBytes);

  if (rawBody === undefined || rawBody.byteLength === 0) {
    return {
      body: {},
      preview,
    };
  }

  const contentType = getHeaderValue(req.headers['content-type'])?.toLowerCase() ?? '';

  if (contentType.includes('json')) {
    const textBody = rawBody.toString('utf8').trim();

    if (textBody.length === 0) {
      return {
        body: {},
        preview,
      };
    }

    try {
      const parsed = JSON.parse(textBody) as unknown;

      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          body: parsed as Record<string, any>,
          preview,
        };
      }

      return {
        body: { value: parsed },
        preview,
      };
    } catch {
      return {
        body: { raw: textBody },
        preview,
      };
    }
  }

  if (contentType.includes('x-www-form-urlencoded')) {
    return {
      body: parseQuery(new URLSearchParams(rawBody.toString('utf8'))),
      preview,
    };
  }

  if (isTextualContentType(contentType)) {
    return {
      body: { raw: rawBody.toString('utf8') },
      preview,
    };
  }

  return {
    body: {},
    preview,
  };
}
