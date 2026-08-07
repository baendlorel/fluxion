/**
 * 共享类型定义
 */

export interface FluxionInstanceOptions {
  /** 解析器，如 tsx、node 等。默认 node */
  interpreter?: string;
  /** 工作目录，默认 process.cwd() */
  cwd?: string;
  /** 入口文件，会被 interpreter 执行 */
  entry: string;
  /** 最大重启次数，默认 3 */
  maxRestarts?: number;
  /** 环境变量，默认 process.env */
  env?: Record<string, string | undefined>;
}

export interface NormalizedFluxionInstanceOptions {
  interpreter: string;
  cwd: string;
  entry: string;
  maxRestarts: number;
  env: Record<string, string | undefined>;
}

export type InstanceStatus = 'online' | 'stopped' | 'errored';

export interface InstanceInfo {
  uid: string;
  pid: number;
  status: InstanceStatus;
  startTime: number;
  restartCount: number;
  maxRestarts: number;
  cwd: string;
  entry: string;
  interpreter: string;
  env: Record<string, string | undefined>;
}

export interface IpcMessage {
  id: string;
  type: 'req' | 'res';
  method: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: string; message: string };
}