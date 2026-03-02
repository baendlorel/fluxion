import type http from 'node:http';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { Readable, Writable } from 'node:stream';

import type { protocol } from './protocol.js';

/**
 * Worker bootstrap data injected by main thread.
 */
interface WorkerBootstrapData {
  /**
   * Memory telemetry interval in milliseconds.
   */
  memorySampleIntervalMs?: number;
  /**
   * ! Maximum response payload size allowed for one request.
   */
  maxResponseBytes?: number;
  /**
   * Stable worker id.
   */
  workerId?: string;
  /**
   * Database names available in this worker.
   */
  dbSet?: string[];
  /**
   * Normalized db configs available for this worker.
   */
  dbConfigMap?: protocol.WorkerDbConfigMap;
}

/**
 * Worker-local connected db client entry.
 */
interface WorkerModuleConnection {
  /**
   * Value injected into handler context.
   */
  value: unknown;
  /**
   * Stable module signature used for conflict detection.
   */
  signature: string;
  /**
   * Optional teardown hook for worker shutdown.
   */
  close?(): Promise<void>;
}

/**
 * Module declaration parsed from handler export.
 */
interface ParsedHandlerModuleDeclaration {
  /**
   * Module id used by dynamic import.
   */
  module: string;
  /**
   * Context key where the created value will be injected.
   */
  injectKey: string;
  /**
   * Serialized factory function source.
   */
  factorySource: string;
  /**
   * Optional factory options.
   */
  options?: unknown;
}

/**
 * Third argument passed to dynamic handlers.
 */
interface HandlerContext {
  /**
   * Database slots declared by handler metadata.
   * & Reserved for worker strategy routing metadata.
   */
  db: Record<string, undefined>;
  /**
   * Checks whether current worker can access a database name.
   */
  hasDb(name: string): boolean;
  /**
   * Worker identity and capability snapshot.
   */
  worker: {
    /**
     * Worker id.
     */
    id: string;
    /**
     * Worker-level database capability set.
     */
    dbSet: string[];
  };
  /**
   * Runtime can inject extra module instances by `injectKey`.
   */
  [key: string]: unknown;
}

/**
 * Handler function signature exported by dynamic modules.
 */
type ModuleDefaultHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  context: HandlerContext,
) => unknown;

/**
 * Object-style default export for handler metadata.
 */
interface ModuleDefaultHandlerObject {
  /**
   * Runtime handler function.
   */
  handler: ModuleDefaultHandler;
  /**
   * Required database names (`string | string[]`).
   */
  db?: unknown;
  /**
   * Dynamic module injection declarations.
   */
  modules?: unknown;
}

/**
 * Parsed handler module export.
 */
interface ParsedModuleDefault {
  /**
   * Runtime handler function.
   */
  handler: ModuleDefaultHandler;
  /**
   * Handler metadata used by worker routing.
   */
  meta: protocol.HandlerMeta;
  /**
   * Dynamic module declarations.
   */
  modules: ParsedHandlerModuleDeclaration[];
}

/**
 * Cached handler entry inside one worker lifecycle.
 */
interface HandlerCacheEntry extends ParsedModuleDefault {
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
 * Runtime bootstrap options resolved from workerData.
 */
const bootstrapData = workerData as WorkerBootstrapData | undefined;

/**
 * Memory report interval provided by main thread.
 */
const memorySampleIntervalMs =
  typeof bootstrapData?.memorySampleIntervalMs === 'number' && bootstrapData.memorySampleIntervalMs > 0
    ? Math.floor(bootstrapData.memorySampleIntervalMs)
    : 5000;

/**
 * ! Maximum response size for a single handler execution.
 */
const maxResponseBytes =
  typeof bootstrapData?.maxResponseBytes === 'number' && bootstrapData.maxResponseBytes > 0
    ? Math.floor(bootstrapData.maxResponseBytes)
    : 2 * 1024 * 1024;

/**
 * Worker identity string used in handler context.
 */
const workerId = typeof bootstrapData?.workerId === 'string' ? bootstrapData.workerId : 'runtime-worker';

/**
 * Database capability set available in this worker.
 */
const workerDbSet = normalizeDbList(bootstrapData?.dbSet);

/**
 * Fast lookup set for worker DB capability checks.
 */
const workerDbNameSet = new Set(workerDbSet);

/**
 * Worker-local db connection registry.
 */
const workerModuleConnections = new Map<string, WorkerModuleConnection>();

/**
 * Converts unknown errors to protocol error payload.
 */
function toWorkerError(error: unknown): protocol.SerializedError {
  const err = error as NodeJS.ErrnoException;
  const isError = error instanceof Error;

  return {
    name: isError ? error.name : 'Error',
    message: isError ? error.message : String(error),
    stack: isError ? error.stack : undefined,
    code: typeof err.code === 'string' ? err.code : undefined,
  };
}

/**
 * Normalizes database names from metadata/config input.
 */
function normalizeDbList(input: unknown): string[] {
  if (typeof input === 'string') {
    const normalized = input.trim();
    return normalized.length === 0 ? [] : [normalized];
  }

  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (typeof item !== 'string') {
      continue;
    }

    const name = item.trim();
    if (name.length === 0 || seen.has(name)) {
      continue;
    }

    seen.add(name);
    normalized.push(name);
  }

  normalized.sort((left, right) => left.localeCompare(right));
  return normalized;
}

/**
 * Runtime shape guard for plain object values.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Converts values into stable JSON-compatible structure for signature generation.
 */
function toStableJsonValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
    const normalized: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const child = toStableJsonValue(value[key]);
      if (child !== undefined) {
        normalized[key] = child;
      }
    }

    return normalized;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
    return undefined;
  }

  return value;
}

/**
 * Builds stable signature string for module conflict detection.
 */
function toModuleSignature(definition: ParsedHandlerModuleDeclaration): string {
  return JSON.stringify({
    module: definition.module,
    injectKey: definition.injectKey,
    factorySource: definition.factorySource,
    options: toStableJsonValue(definition.options),
  });
}

/**
 * Validates handler db declaration shape.
 */
function parseHandlerDbList(input: unknown, filePath: string): string[] {
  if (input === undefined || typeof input === 'string' || Array.isArray(input)) {
    return normalizeDbList(input);
  }

  throw new TypeError(`Invalid db declaration in ${filePath}: use db: string | string[]`);
}

/**
 * Validates module declaration list from handler export.
 */
function parseHandlerModuleDeclarations(input: unknown, filePath: string): ParsedHandlerModuleDeclaration[] {
  if (input === undefined) {
    return [];
  }

  if (!Array.isArray(input)) {
    throw new TypeError(`Invalid modules declaration in ${filePath}: modules must be an array`);
  }

  const declarations: ParsedHandlerModuleDeclaration[] = [];
  const seenInjectKeys = new Set<string>();

  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (!isRecord(item)) {
      throw new TypeError(`Invalid modules[${i}] in ${filePath}: expected object`);
    }

    const rawModule = typeof item.module === 'string' ? item.module.trim() : '';
    if (rawModule.length === 0) {
      throw new TypeError(`Invalid modules[${i}] in ${filePath}: module is required`);
    }

    const rawInjectKey = typeof item.injectKey === 'string' ? item.injectKey.trim() : '';
    if (rawInjectKey.length === 0) {
      throw new TypeError(`Invalid modules[${i}] in ${filePath}: injectKey is required`);
    }

    if (rawInjectKey === 'db' || rawInjectKey === 'worker' || rawInjectKey === 'hasDb') {
      throw new TypeError(`Invalid modules[${i}] in ${filePath}: injectKey "${rawInjectKey}" is reserved`);
    }

    if (seenInjectKeys.has(rawInjectKey)) {
      throw new TypeError(`Duplicate injectKey "${rawInjectKey}" in ${filePath}`);
    }

    const factory = item.factory;
    if (typeof factory !== 'function') {
      throw new TypeError(`Invalid modules[${i}] in ${filePath}: factory must be a function`);
    }

    seenInjectKeys.add(rawInjectKey);
    declarations.push({
      module: rawModule,
      injectKey: rawInjectKey,
      factorySource: factory.toString(),
      options: item.options,
    });
  }

  return declarations;
}

/**
 * Re-hydrates a serialized module factory source.
 */
function createModuleFactory(
  factorySource: string,
  filePath: string,
  injectKey: string,
): (...args: unknown[]) => unknown {
  let factory: unknown;
  const sourceCandidates = [factorySource];

  const methodPattern = /^(async\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*\(/;
  if (methodPattern.test(factorySource)) {
    const asyncPrefix = factorySource.startsWith('async ') ? 'async ' : '';
    const parenIndex = factorySource.indexOf('(');
    sourceCandidates.push(`${asyncPrefix}function ${factorySource.slice(parenIndex)}`);
  }

  let restoreError: unknown;
  for (let i = 0; i < sourceCandidates.length; i++) {
    try {
      factory = new Function(`return (${sourceCandidates[i]});`)();
      restoreError = undefined;
      break;
    } catch (error) {
      restoreError = error;
    }
  }

  if (factory === undefined || restoreError !== undefined) {
    const reviveError = new Error(
      `Failed to revive module factory for "${injectKey}" in ${filePath}: ${
        restoreError instanceof Error ? restoreError.message : String(restoreError)
      }`,
    );
    (reviveError as NodeJS.ErrnoException).code = 'WORKER_MODULE_FACTORY_RESTORE_FAILED';
    throw reviveError;
  }

  if (typeof factory !== 'function') {
    const typeError = new Error(`Module factory for "${injectKey}" in ${filePath} did not restore to a function`);
    (typeError as NodeJS.ErrnoException).code = 'WORKER_MODULE_FACTORY_RESTORE_FAILED';
    throw typeError;
  }

  return factory as (...args: unknown[]) => unknown;
}

/**
 * Resolves close hook from one injected module value.
 */
function resolveModuleCloseHook(value: unknown): (() => Promise<void>) | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const dispose = value['dispose'];
  if (typeof dispose === 'function') {
    return async (): Promise<void> => {
      await dispose.call(value);
    };
  }

  const close = value['close'];
  if (typeof close === 'function') {
    return async (): Promise<void> => {
      await close.call(value);
    };
  }

  const end = value['end'];
  if (typeof end === 'function') {
    return async (): Promise<void> => {
      await end.call(value);
    };
  }

  const destroy = value['destroy'];
  if (typeof destroy === 'function') {
    return async (): Promise<void> => {
      await destroy.call(value);
    };
  }

  return undefined;
}

/**
 * Creates one worker-local module injection value.
 */
async function createModuleConnection(
  definition: ParsedHandlerModuleDeclaration,
  filePath: string,
): Promise<WorkerModuleConnection> {
  let importedModule: unknown;

  try {
    importedModule = await import(definition.module);
  } catch (error) {
    const importError = new Error(
      `Failed to import module "${definition.module}" for "${definition.injectKey}" in ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    (importError as NodeJS.ErrnoException).code = 'WORKER_MODULE_IMPORT_FAILED';
    throw importError;
  }

  const factory = createModuleFactory(definition.factorySource, filePath, definition.injectKey);

  let createdValue: unknown;
  try {
    createdValue = factory(importedModule, definition.options, {
      filePath,
      workerId,
      workerDbSet: [...workerDbSet],
      injectKey: definition.injectKey,
      moduleId: definition.module,
    });
  } catch (error) {
    const factoryError = new Error(
      `Module factory threw for "${definition.injectKey}" in ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    (factoryError as NodeJS.ErrnoException).code = 'WORKER_MODULE_FACTORY_FAILED';
    throw factoryError;
  }

  if (isPromiseLike(createdValue)) {
    createdValue = await createdValue;
  }

  return {
    value: createdValue,
    signature: toModuleSignature(definition),
    close: resolveModuleCloseHook(createdValue),
  };
}

/**
 * Ensures worker has initialized modules declared by current handler.
 */
async function ensureWorkerModuleConnections(
  filePath: string,
  definitions: readonly ParsedHandlerModuleDeclaration[],
): Promise<void> {
  for (let i = 0; i < definitions.length; i++) {
    const definition = definitions[i];
    const signature = toModuleSignature(definition);
    const existing = workerModuleConnections.get(definition.injectKey);

    if (existing !== undefined) {
      if (existing.signature !== signature) {
        const conflictError = new Error(
          `Conflicting module declaration for injectKey "${definition.injectKey}" in worker "${workerId}": ${filePath}`,
        );
        (conflictError as NodeJS.ErrnoException).code = 'WORKER_MODULE_CONFLICT';
        throw conflictError;
      }

      continue;
    }

    const connection = await createModuleConnection(definition, filePath);
    workerModuleConnections.set(definition.injectKey, connection);
  }
}

/**
 * Closes all worker-local module connections.
 */
async function closeWorkerModuleConnections(): Promise<void> {
  const connections = Array.from(workerModuleConnections.values());
  workerModuleConnections.clear();

  for (let i = 0; i < connections.length; i++) {
    const close = connections[i].close;
    if (close === undefined) {
      continue;
    }

    try {
      await close();
    } catch {
      // ignore close error during worker teardown
    }
  }
}

/**
 * Runtime guard for promise-like handler return values.
 */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

/**
 * Parses default export into handler + metadata shape.
 */
function parseModuleDefault(defaultExport: unknown, filePath: string): ParsedModuleDefault {
  if (typeof defaultExport === 'function') {
    return {
      handler: defaultExport as ModuleDefaultHandler,
      meta: { db: [] },
      modules: [],
    };
  }

  if (isRecord(defaultExport)) {
    const objectExport = defaultExport as Partial<ModuleDefaultHandlerObject>;
    if (typeof objectExport.handler !== 'function') {
      throw new TypeError(
        `Default export must be a function or { handler, db?, modules? }: ${filePath}`,
      );
    }

    return {
      handler: objectExport.handler,
      meta: {
        db: parseHandlerDbList(objectExport.db, filePath),
      },
      modules: parseHandlerModuleDeclarations(objectExport.modules, filePath),
    };
  }

  throw new TypeError(
    `Default export must be a function or { handler, db?, modules? }: ${filePath}`,
  );
}

/**
 * ! Validates handler DB requirements against worker capability.
 */
function assertWorkerDbCapability(filePath: string, meta: protocol.HandlerMeta): void {
  const missing = meta.db.filter((name) => !workerDbNameSet.has(name));
  if (missing.length === 0) {
    return;
  }

  const dbError = new Error(
    `Handler requires unavailable db in worker "${workerId}": ${filePath} -> ${missing.join(', ')}`,
  );
  (dbError as NodeJS.ErrnoException).code = 'WORKER_DB_NOT_AVAILABLE';
  throw dbError;
}

/**
 * Builds request context passed as third arg to handler.
 */
function createHandlerContext(
  meta: protocol.HandlerMeta,
  modules: readonly ParsedHandlerModuleDeclaration[],
): HandlerContext {
  const db: Record<string, undefined> = Object.create(null) as Record<string, undefined>;

  for (let i = 0; i < meta.db.length; i++) {
    db[meta.db[i]] = undefined;
  }

  const context: HandlerContext = {
    db,
    hasDb(name: string): boolean {
      return workerDbNameSet.has(name);
    },
    worker: {
      id: workerId,
      dbSet: [...workerDbSet],
    },
  };

  for (let i = 0; i < modules.length; i++) {
    const moduleDeclaration = modules[i];
    const connection = workerModuleConnections.get(moduleDeclaration.injectKey);
    if (connection !== undefined) {
      context[moduleDeclaration.injectKey] = connection.value;
    }
  }

  return context;
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
   * ! Maximum response body bytes allowed.
   */
  private readonly maxBodyBytes: number;

  /**
   * Response headers map (lowercased keys).
   */
  private readonly headerMap = new Map<string, string>();

  /**
   * Buffered body chunks.
   */
  private readonly bodyChunks: Buffer[] = [];

  /**
   * Total bytes currently buffered.
   */
  private totalBodyBytes = 0;

  /**
   * @param maxBodyBytes Maximum body bytes before hard-failing.
   */
  constructor(maxBodyBytes: number) {
    super();
    this.maxBodyBytes = maxBodyBytes;
  }

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
      this.appendChunk(toBuffer(chunk, resolvedEncoding));
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

    const body = new Uint8Array(this.totalBodyBytes);
    let offset = 0;

    for (let i = 0; i < this.bodyChunks.length; i++) {
      const chunk = this.bodyChunks[i];
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      statusCode: this.statusCode,
      headers: this.getHeaders(),
      body,
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
    try {
      this.appendChunk(toBuffer(chunk, encoding));
      callback();
    } catch (error) {
      callback(error as Error);
    }
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

  /**
   * ! Appends one response chunk and enforces body size cap.
   */
  private appendChunk(chunk: Buffer): void {
    if (chunk.byteLength === 0) {
      return;
    }

    const nextTotalBytes = this.totalBodyBytes + chunk.byteLength;
    if (nextTotalBytes > this.maxBodyBytes) {
      const sizeError = new Error(
        `worker response too large: ${nextTotalBytes} bytes exceeds ${this.maxBodyBytes} bytes`,
      );
      (sizeError as NodeJS.ErrnoException).code = 'WORKER_RESPONSE_TOO_LARGE';
      throw sizeError;
    }

    this.totalBodyBytes = nextTotalBytes;
    this.bodyChunks.push(chunk);
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
 * Loads handler module and resolves metadata.
 * ! If version differs inside the same worker, supervisor must restart worker first.
 */
async function loadHandler(filePath: string, version: string): Promise<HandlerCacheEntry> {
  const cached = handlerCache.get(filePath);
  if (cached !== undefined) {
    if (cached.version === version) {
      return cached;
    }

    const versionError = new Error(`Handler version changed in worker: ${filePath}`);
    (versionError as NodeJS.ErrnoException).code = 'WORKER_VERSION_MISMATCH';
    throw versionError;
  }

  const loaded = await import(pathToFileURL(filePath).href);
  const parsed = parseModuleDefault(loaded.default as unknown, filePath);

  assertWorkerDbCapability(filePath, parsed.meta);
  await ensureWorkerModuleConnections(filePath, parsed.modules);

  const entry: HandlerCacheEntry = {
    handler: parsed.handler,
    version,
    meta: parsed.meta,
    modules: parsed.modules,
  };

  handlerCache.set(filePath, entry);
  return entry;
}

/**
 * Executes one request and returns worker result message.
 */
async function execute(message: protocol.ExecuteMessage): Promise<protocol.ResultMessage> {
  const startedAt = Date.now();
  const payload = message.payload;

  try {
    const entry = await loadHandler(payload.filePath, payload.version);
    const request = createIncomingRequest(payload);
    const response = new MemoryServerResponse(maxResponseBytes) as unknown as http.ServerResponse;
    const execution = entry.handler(request, response, createHandlerContext(entry.meta, entry.modules));

    if (isPromiseLike(execution)) {
      await execution;
    }

    const writableResponse = response as unknown as MemoryServerResponse;
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
      meta: entry.meta,
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
 * Resolves metadata without executing the handler.
 */
async function inspect(message: protocol.InspectMessage): Promise<protocol.InspectResultMessage> {
  try {
    const entry = await loadHandler(message.payload.filePath, message.payload.version);

    return {
      type: 'inspect_result',
      id: message.id,
      ok: true,
      meta: entry.meta,
    };
  } catch (error) {
    return {
      type: 'inspect_result',
      id: message.id,
      ok: false,
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
 * Posts outbound message and transfers body buffer when present.
 */
function postOutboundMessage(message: protocol.OutboundMessage): void {
  if (message.type !== 'result' || !message.ok || message.response?.body === undefined) {
    port.postMessage(message);
    return;
  }

  const body = message.response.body;
  if (body.byteLength === 0) {
    port.postMessage(message);
    return;
  }

  port.postMessage(message, [body.buffer as ArrayBuffer]);
}

/**
 * Periodically reports worker memory usage.
 */
const memoryReporter = setInterval(() => {
  const usage = process.memoryUsage();

  const message: protocol.MemoryMessage = {
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
 * Idempotent module teardown promise.
 */
let dbClosePromise: Promise<void> | undefined;

/**
 * Closes worker module connections once.
 */
function disposeDbConnections(): Promise<void> {
  if (dbClosePromise === undefined) {
    dbClosePromise = closeWorkerModuleConnections();
  }

  return dbClosePromise;
}

process.once('beforeExit', () => {
  void disposeDbConnections();
});

/**
 * Main worker message loop.
 */
port.on('message', (message: protocol.InboundMessage) => {
  if (message.type === 'execute') {
    void execute(message).then((result) => {
      postOutboundMessage(result);
    });
    return;
  }

  if (message.type === 'inspect') {
    void inspect(message).then((result) => {
      port.postMessage(result);
    });
  }
});
