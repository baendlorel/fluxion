import http from 'node:http';
import { parseQuery } from './query.js';
import { isTextualContentType } from './headers.js';

function createRequestBodyTooLargeError(receivedBytes: number, maxBytes: number): NodeJS.ErrnoException {
  const sizeError = new Error(
    `request body too large: ${receivedBytes.toString()} bytes exceeds ${maxBytes.toString()} bytes`,
  ) as NodeJS.ErrnoException;

  sizeError.code = 'REQUEST_BODY_TOO_LARGE';

  return sizeError;
}

export async function readRequestBody(
  req: http.IncomingMessage,
  method: string,
  maxBytes: number,
): Promise<Buffer | undefined> {
  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }

  if (req.readableEnded) {
    return undefined;
  }

  const contentLengthHeader = req.headers['content-length'];
  const contentLengthRaw = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader;

  if (contentLengthRaw !== undefined) {
    const declaredBytes = Number.parseInt(contentLengthRaw, 10);

    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw createRequestBodyTooLargeError(declaredBytes, maxBytes);
    }
  }

  return new Promise((resolve, reject) => {
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

      if (totalBytes > maxBytes) {
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
      settle(() => {
        if (chunks.length === 0) {
          resolve(undefined);
          return;
        }

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

export async function parseBody(
  req: http.IncomingMessage,
  method: string,
  maxBytes: number,
): Promise<Record<string, any>> {
  const rawBody = await readRequestBody(req, method, maxBytes);

  if (rawBody === undefined || rawBody.byteLength === 0) {
    return {};
  }

  const rawContentType = req.headers['content-type'];
  const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType)?.toLowerCase() ?? '';

  if (contentType.includes('json')) {
    const textBody = rawBody.toString('utf8').trim();
    if (textBody.length === 0) {
      return {};
    }

    try {
      const parsed = JSON.parse(textBody) as unknown;

      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }

      return { value: parsed };
    } catch {
      return { raw: textBody };
    }
  }

  if (contentType.includes('x-www-form-urlencoded')) {
    return parseQuery(new URLSearchParams(rawBody.toString('utf8')));
  }

  if (isTextualContentType(contentType)) {
    return { raw: rawBody.toString('utf8') };
  }

  return {};
}
