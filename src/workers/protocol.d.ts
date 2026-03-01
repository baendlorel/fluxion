/**
 * IPC protocol between main thread and runtime worker.
 */
export namespace protocol {
  /**
   * HTTP header value.
   */
  export type HeaderValue = string | string[];

  /**
   * HTTP header map.
   */
  export type Headers = Record<string, HeaderValue>;

  /**
   * Execute payload sent to worker.
   */
  export interface Payload {
    /**
     * Absolute path of the handler file.
     */
    filePath: string;
    /**
     * Version token generated from file metadata.
     */
    version: string;
    /**
     * HTTP method.
     */
    method: string;
    /**
     * Raw request target (pathname + query).
     */
    url: string;
    /**
     * Request headers.
     */
    headers: Headers;
    /**
     * Request body as binary payload.
     */
    body?: Uint8Array;
    /**
     * Client ip captured in main thread.
     */
    ip: string;
  }

  /**
   * Main -> worker execute command.
   */
  export interface ExecuteMessage {
    type: 'execute';
    /**
     * Correlation id for this request.
     */
    id: string;
    payload: Payload;
  }

  /**
   * Worker response payload to be applied on ServerResponse.
   */
  export interface SerializedResponse {
    /**
     * HTTP status code.
     */
    statusCode: number;
    /**
     * Serialized response headers.
     */
    headers: Record<string, string>;
    /**
     * Optional response body bytes.
     */
    body?: Uint8Array;
  }

  /**
   * Serialized runtime error.
   */
  export interface SerializedError {
    /**
     * Error class name.
     */
    name: string;
    /**
     * Error message.
     */
    message: string;
    /**
     * Optional stack trace.
     */
    stack?: string;
    /**
     * Optional error code.
     */
    code?: string;
  }

  /**
   * Worker -> main result event.
   */
  export interface ResultMessage {
    type: 'result';
    /**
     * Correlation id matching ExecuteMessage.id.
     */
    id: string;
    /**
     * Whether execution succeeded.
     */
    ok: boolean;
    /**
     * Handler execution time in milliseconds.
     */
    elapsedMs: number;
    /**
     * Heap used when result is produced.
     */
    heapUsed: number;
    response?: SerializedResponse;
    error?: SerializedError;
  }

  /**
   * Worker -> main periodic memory report.
   */
  export interface MemoryMessage {
    type: 'memory';
    /**
     * V8 heap used bytes.
     */
    heapUsed: number;
    /**
     * Resident set size bytes.
     */
    rss: number;
    /**
     * External memory bytes.
     */
    external: number;
    /**
     * ArrayBuffer memory bytes.
     */
    arrayBuffers: number;
  }

  /**
   * Union of commands accepted by worker.
   */
  export type InboundMessage = ExecuteMessage;

  /**
   * Union of events emitted by worker.
   */
  export type OutboundMessage = ResultMessage | MemoryMessage;
}
