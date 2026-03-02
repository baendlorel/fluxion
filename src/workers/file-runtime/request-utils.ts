import type http from 'node:http';

import type { NormalizedRequest } from '@/core/types.js';
import { parseQuery, toURL } from '@/core/utils/request.js';
import type { protocol } from '@/workers/protocol.js';

/**
 * Creates a typed request-body-too-large runtime error.
 */
export function createRequestBodyTooLargeError(receivedBytes: number, maxBytes: number): Error {
  const sizeError = new Error(`request body too large: ${receivedBytes} bytes exceeds ${maxBytes} bytes`);
  (sizeError as NodeJS.ErrnoException).code = 'REQUEST_BODY_TOO_LARGE';
  return sizeError;
}

/**
 * Validates max request body option.
 */
export function resolveMaxRequestBytes(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value)) {
    throw new Error('Invalid maxRequestBytes: must be a finite number');
  }

  const normalized = Math.floor(value);
  if (normalized <= 0) {
    throw new Error('Invalid maxRequestBytes: must be greater than 0');
  }

  return normalized;
}

/**
 * Normalizes request data when caller didn't pre-normalize.
 */
export function normalizeRequest(req: http.IncomingMessage, normalized?: NormalizedRequest): NormalizedRequest | undefined {
  if (normalized !== undefined) {
    return normalized;
  }

  const url = toURL(req.url);
  if (url === undefined) {
    return undefined;
  }

  const socket = req.socket as { remoteAddress?: string | undefined } | undefined;

  return {
    method: req.method ?? 'GET',
    ip: socket?.remoteAddress ?? 'unknown',
    url,
    query: parseQuery(url.searchParams),
  };
}

/**
 * Serializes IncomingHttpHeaders for worker protocol.
 */
export function normalizeHeaders(headers: http.IncomingHttpHeaders): protocol.Headers {
  const serializedHeaders: protocol.Headers = {};

  const headerKeys = Object.keys(headers);
  for (let i = 0; i < headerKeys.length; i++) {
    const key = headerKeys[i];
    const value = headers[key];

    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      serializedHeaders[key] = value;
      continue;
    }

    serializedHeaders[key] = value;
  }

  return serializedHeaders;
}

/**
 * Reads request body once before worker execution.
 * ! Body stream is consumable; do not read it elsewhere first.
 */
export async function readRequestBody(
  req: http.IncomingMessage,
  method: string,
  maxBytes: number | undefined,
): Promise<Uint8Array | undefined> {
  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }

  if (req.readableEnded) {
    return undefined;
  }

  if (maxBytes !== undefined) {
    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader !== undefined) {
      const declaredBytes = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
        throw createRequestBodyTooLargeError(declaredBytes, maxBytes);
      }
    }
  }

  return new Promise<Uint8Array | undefined>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
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

    const onData = (chunk: Buffer | string): void => {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bufferChunk.byteLength;

      if (maxBytes !== undefined && totalBytes > maxBytes) {
        cleanup();
        req.resume();
        settle(() => {
          reject(createRequestBodyTooLargeError(totalBytes, maxBytes));
        });
        return;
      }

      chunks.push(bufferChunk);
    };

    const onEnd = (): void => {
      cleanup();

      if (chunks.length === 0) {
        settle(() => {
          resolve(undefined);
        });
        return;
      }

      settle(() => {
        resolve(Buffer.concat(chunks));
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

/**
 * Applies serialized worker response back onto ServerResponse.
 */
export function applyWorkerResponse(res: http.ServerResponse, response: protocol.SerializedResponse): void {
  res.statusCode = response.statusCode;

  const headerKeys = Object.keys(response.headers);
  for (let i = 0; i < headerKeys.length; i++) {
    const key = headerKeys[i];
    res.setHeader(key, response.headers[key]);
  }

  if (response.body === undefined || response.body.byteLength === 0) {
    res.end();
    return;
  }

  const body = Buffer.from(response.body.buffer, response.body.byteOffset, response.body.byteLength);
  res.end(body);
}
