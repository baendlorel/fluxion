import { resolve } from 'node:path';
import type { FluxionInstanceOptions, NormalizedFluxionInstanceOptions } from '../shared/types.js';

/**
 * 定义 Fluxion 实例配置。
 * 用于 .fluxion.config.ts 配置文件
 */
export function defineFluxionInstance(o: FluxionInstanceOptions): NormalizedFluxionInstanceOptions {
  return {
    interpreter: o.interpreter ?? 'node',
    cwd: resolve(o.cwd ?? process.cwd()),
    entry: o.entry,
    maxRestarts: o.maxRestarts ?? 3,
    env: o.env ?? { ...process.env },
  };
}