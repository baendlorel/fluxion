import path from 'node:path';
import type { InjectionConfig } from '@/common/types.js';
import type { FluxionContext } from '@/core/types.js';

export function loadFunction(cx: Pick<FluxionContext, 'options'>): (...args: any[]) => any {
  const config = cx.options.logger as InjectionConfig;
  const p = path.join(cx.options.moduleDir, config.modulePath);
  const m = require(p);
  if (typeof m === 'function') {
    return m;
  } else if (typeof m.default === 'function') {
    return m.default;
  } else if (typeof m.handler === 'function') {
    return m.handler;
  } else {
    $throw(
      `Invalid handler module '${p}', make sure it has a default export or named export called "handler" which is a function`,
    );
  }
}
