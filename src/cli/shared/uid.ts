import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * 基于 cwd + entry 计算稳定的 UID。
 * 同一项目始终得到相同 uid → start 时检测是否已在运行
 * 不同项目必然不同 uid → 不会冲突
 */
export function computeUid(cwd: string, entry: string): string {
  const hash = createHash('sha256');
  hash.update(resolve(cwd));
  hash.update(resolve(cwd, entry));
  return hash.digest('hex').slice(0, 12);
}