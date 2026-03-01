export type WorkerHeaderValue = string | string[];

export type WorkerHeaders = Record<string, WorkerHeaderValue>;

export interface WorkerExecutePayload {
  filePath: string;
  version: string;
  method: string;
  url: string;
  headers: WorkerHeaders;
  body?: Uint8Array;
  ip: string;
}

export interface WorkerExecuteMessage {
  type: 'execute';
  id: string;
  payload: WorkerExecutePayload;
}

export interface WorkerSerializedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body?: Uint8Array;
}

export interface WorkerSerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
}

export interface WorkerResultMessage {
  type: 'result';
  id: string;
  ok: boolean;
  elapsedMs: number;
  heapUsed: number;
  response?: WorkerSerializedResponse;
  error?: WorkerSerializedError;
}

export interface WorkerMemoryMessage {
  type: 'memory';
  heapUsed: number;
  rss: number;
  external: number;
  arrayBuffers: number;
}

export type WorkerInboundMessage = WorkerExecuteMessage;

export type WorkerOutboundMessage = WorkerResultMessage | WorkerMemoryMessage;
