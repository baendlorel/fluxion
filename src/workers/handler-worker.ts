import type http from 'node:http';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { Readable, Writable } from 'node:stream';

import type { protocol } from './protocol.js';

/**
 * Handler function signature exported by dynamic modules.
 */
type ModuleDefaultHandler = (req: http.IncomingMessage, res: http.ServerResponse) => unknown;

/**
 * Cached handler entry inside one worker lifecycle.
 */
interface HandlerCacheEntry {
  /**
   * Loaded handler function.
   */
  handler: ModuleDefaultHandler;
  /**
   * Version token used by main thread.
   */
  version: string;
}

/**
 * Worker-local handler cache.
 */
const handlerCache = new Map<string, HandlerCacheEntry>();

/**
 * Converts unknown errors to protocol error payload.
 */
function toWorkerError(error: unknown): protocol.SerializedError {
  const err = error as NodeJS.ErrnoException;

  return {
    name: Error.isError(error) ? error.name : 'Error',
    message: Error.isError(error) ? error.message : String(error),
    stack: Error.isError(error) ? error.stack : undefined,
    code: typeof err.code === 'string' ? err.code : undefined,
  };
}

/**
 * In-memory ServerResponse used to run handlers without socket access.
 * & This lets existing `(req, res)` handlers run unchanged inside worker.
 */
class MemoryServerResponse extends Writable {
  /**
   * HTTP status code.
   */
  public statusCode = 200;

  /**
   * Optional status text.
   */
  public statusMessage = '';

  /**
   * Response headers map (lowercased keys).
   */
  private readonly headerMap = new Map<string, string>();

  /**
   * Buffered body chunks.
   */
  private readonly bodyChunks: Buffer[] = [];

  /**
   * Sets response header.
   */
  setHeader(name: string, value: string | number | readonly string[]): this {
    const normalizedName = name.toLowerCase();

    if (Array.isArray(value)) {
      this.headerMap.set(normalizedName, value.join(', '));
      return this;
    }

    this.headerMap.set(normalizedName, String(value));
    return this;
  }

  /**
   * Gets response header.
   */
  getHeader(name: string): string | undefined {
    return this.headerMap.get(name.toLowerCase());
  }

  /**
   * Returns all response headers.
   */
  getHeaders(): Record<string, string> {
    return Object.fromEntries(this.headerMap.entries());
  }

  /**
   * Removes response header.
   */
  removeHeader(name: string): void {
    this.headerMap.delete(name.toLowerCase());
  }

  /**
   * Sets status and optional headers.
   */
  writeHead(
    statusCode: number,
    statusMessageOrHeaders?: string | http.OutgoingHttpHeaders,
    headers?: http.OutgoingHttpHeaders,
  ): this {
    this.statusCode = statusCode;

    if (typeof statusMessageOrHeaders === 'string') {
      this.statusMessage = statusMessageOrHeaders;
      this.applyHeaders(headers);
      return this;
    }

    this.applyHeaders(statusMessageOrHeaders);
    return this;
  }

  /**
   * Ends response stream and stores optional final chunk.
   */
  override end(chunk?: unknown, encoding?: BufferEncoding | (() => void), cb?: () => void): this {
    const resolvedCallback = typeof encoding === 'function' ? encoding : cb;
    const resolvedEncoding = typeof encoding === 'string' ? encoding : undefined;

    if (chunk !== undefined && chunk !== null) {
      const normalizedChunk = toBuffer(chunk, resolvedEncoding);
      this.bodyChunks.push(normalizedChunk);
    }

    return super.end(resolvedCallback);
  }

  /**
   * Serializes buffered response back to main thread.
   */
  toSerializedResponse(): protocol.SerializedResponse {
    if (this.bodyChunks.length === 0) {
      return {
        statusCode: this.statusCode,
        headers: this.getHeaders(),
      };
    }

    return {
      statusCode: this.statusCode,
      headers: this.getHeaders(),
      body: Buffer.concat(this.bodyChunks),
    };
  }

  /**
   * Writable sink used by `res.write`.
   */
  override _write(
    chunk: Buffer | string | Uint8Array,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.bodyChunks.push(toBuffer(chunk, encoding));
    callback();
  }

  /**
   * Applies OutgoingHttpHeaders into internal map.
   */
  private applyHeaders(headers?: http.OutgoingHttpHeaders): void {
    if (headers === undefined) {
      return;
    }

    const headerKeys = Object.keys(headers);
    for (let i = 0; i < headerKeys.length; i++) {
      const key = headerKeys[i];
      const value = headers[key];
      if (value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        this.setHeader(
          key,
          value.map((item) => String(item)),
        );
        continue;
      }

      this.setHeader(key, String(value));
    }
  }
}

/**
 * Normalizes write chunks into Buffer.
 */
function toBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }

  if (typeof chunk === 'string') {
    return Buffer.from(chunk, encoding);
  }

  return Buffer.from(String(chunk));
}

/**
 * Builds a synthetic IncomingMessage from protocol payload.
 */
function createIncomingRequest(payload: protocol.Payload): http.IncomingMessage {
  const bodyChunk = payload.body;
  const source = bodyChunk !== undefined && bodyChunk.byteLength > 0 ? [Buffer.from(bodyChunk)] : [];
  const request = Readable.from(source) as unknown as http.IncomingMessage;

  request.method = payload.method;
  request.url = payload.url;

  const headers: http.IncomingHttpHeaders = {};
  const headerKeys = Object.keys(payload.headers);
  for (let i = 0; i < headerKeys.length; i++) {
    const key = headerKeys[i];
    const value: protocol.HeaderValue = payload.headers[key];
    headers[key] = Array.isArray(value) ? [...value] : value;
  }
  request.headers = headers;

  const socketLike = {
    remoteAddress: payload.ip,
  };

  Object.defineProperty(request, 'socket', {
    value: socketLike,
    configurable: true,
    enumerable: true,
    writable: true,
  });

  Object.defineProperty(request, 'connection', {
    value: socketLike,
    configurable: true,
    enumerable: true,
    writable: true,
  });

  return request;
}

/**
 * Loads handler module and validates default export.
 * ! If version differs inside the same worker, supervisor must restart worker first.
 */
async function loadHandler(filePath: string, version: string): Promise<ModuleDefaultHandler> {
  const cached = handlerCache.get(filePath);
  if (cached !== undefined) {
    if (cached.version === version) {
      return cached.handler;
    }

    const versionError = new Error(`Handler version changed in worker: ${filePath}`);
    (versionError as NodeJS.ErrnoException).code = 'WORKER_VERSION_MISMATCH';
    throw versionError;
  }

  const loaded = await import(pathToFileURL(filePath).href);
  const defaultExport = loaded.default;

  if (typeof defaultExport !== 'function') {
    throw new TypeError(`Default export is not a function: ${filePath}`);
  }

  const handler = defaultExport as ModuleDefaultHandler;
  handlerCache.set(filePath, { handler, version });
  return handler;
}

/**
 * Executes one request and returns a protocol message.
 */
async function execute(message: protocol.ExecuteMessage): Promise<protocol.OutboundMessage> {
  const startedAt = Date.now();
  const payload = message.payload;

  try {
    const handler = await loadHandler(payload.filePath, payload.version);
    const request = createIncomingRequest(payload);
    const response = new MemoryServerResponse() as unknown as http.ServerResponse;

    await Promise.resolve(handler(request, response));

    const writableResponse = response as unknown as MemoryServerResponse;
    if (!writableResponse.writableEnded) {
      writableResponse.end();
    }

    if (!writableResponse.writableFinished) {
      await new Promise<void>((resolve, reject) => {
        writableResponse.once('finish', resolve);
        writableResponse.once('error', reject);
      });
    }

    return {
      type: 'result',
      id: message.id,
      ok: true,
      elapsedMs: Date.now() - startedAt,
      heapUsed: process.memoryUsage().heapUsed,
      response: writableResponse.toSerializedResponse(),
    };
  } catch (error) {
    return {
      type: 'result',
      id: message.id,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      heapUsed: process.memoryUsage().heapUsed,
      error: toWorkerError(error),
    };
  }
}

/**
 * ! Worker must run under parentPort; standalone run is invalid.
 */
if (parentPort === null) {
  throw new Error('runtime worker missing parent port');
}
const port = parentPort;

/**
 * Memory report interval provided by main thread.
 */
const memorySampleIntervalMs =
  typeof workerData?.memorySampleIntervalMs === 'number' ? workerData.memorySampleIntervalMs : 5000;

/**
 * Periodically reports worker memory usage.
 */
const memoryReporter = setInterval(() => {
  const usage = process.memoryUsage();

  const message: protocol.OutboundMessage = {
    type: 'memory',
    heapUsed: usage.heapUsed,
    rss: usage.rss,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };

  port.postMessage(message);
}, memorySampleIntervalMs);

memoryReporter.unref();

/**
 * Main worker message loop.
 */
port.on('message', (message: protocol.InboundMessage) => {
  if (message.type !== 'execute') {
    return;
  }

  void execute(message).then((result) => {
    port.postMessage(result);
  });
});
