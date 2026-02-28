import type http from 'node:http';

import { DUMMY_BASE_URL } from '@/common/consts.js';
import { isTextualContentType } from './headers.js';

interface ParsedRequestTarget {
  path: string;
  query: Record<string, string | string[]>;
}

export interface BodyPreview {
  exists: boolean;
  value?: string;
  bytes: number;
  truncated: boolean;
}

export function parseQuery(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];

    if (existing === undefined) {
      query[key] = value;
      continue;
    }

    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }

    query[key] = [existing, value];
  }

  return query;
}

export function parseRequestTarget(rawUrl: string | undefined): ParsedRequestTarget {
  if (rawUrl === undefined) {
    return {
      path: '(unknown)',
      query: {},
    };
  }

  try {
    const parsedUrl = new URL(rawUrl, DUMMY_BASE_URL);
    const pathname = parsedUrl.pathname;

    return {
      path: pathname,
      query: parseQuery(parsedUrl.searchParams),
    };
  } catch {
    return {
      path: rawUrl,
      query: {},
    };
  }
}

export function createBodyPreviewCapture(
  req: http.IncomingMessage,
  maxBytes = 8192,
): { getPreview: () => BodyPreview } {
  const originalPush = req.push;
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

    return originalPush.call(req, chunk as never, encoding);
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
