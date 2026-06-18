import type { InjectionConfig } from '@/common/types.js';

// TODO 要改为能够加载FluxionModule的格式
export function loadFunction(injectionConfig: InjectionConfig): (...args: any[]) => any {
  const m = require(injectionConfig.modulePath);
  if (typeof m === 'function') {
    return m;
  } else if (typeof m.default === 'function') {
    return m.default;
  } else if (typeof m.handler === 'function') {
    return m.handler;
  } else {
    $throw(
      `Invalid handler module '${injectionConfig.modulePath}', make sure it has a default export or named export called "handler" which is a function`,
    );
  }
}
