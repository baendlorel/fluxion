export namespace protocol {
  export type HeaderValue = string | string[];

  export type Headers = Record<string, HeaderValue>;

  export interface Payload {
    filePath: string;
    version: string;
    method: string;
    url: string;
    headers: Headers;
    body?: Uint8Array;
    ip: string;
  }

  export interface ExecuteMessage {
    type: 'execute';
    id: string;
    payload: Payload;
  }

  export interface SerializedResponse {
    statusCode: number;
    headers: Record<string, string>;
    body?: Uint8Array;
  }

  export interface SerializedError {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  }

  export interface ResultMessage {
    type: 'result';
    id: string;
    ok: boolean;
    elapsedMs: number;
    heapUsed: number;
    response?: SerializedResponse;
    error?: SerializedError;
  }

  export interface MemoryMessage {
    type: 'memory';
    heapUsed: number;
    rss: number;
    external: number;
    arrayBuffers: number;
  }

  export type InboundMessage = ExecuteMessage;

  export type OutboundMessage = ResultMessage | MemoryMessage;
}
