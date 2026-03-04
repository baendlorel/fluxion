import path from 'node:path';
import type { InjectionConfig } from '@/common/types.js';
import { fluxionOptions } from '@/core/cluster/global-state.js';

export function loadFunction(config: InjectionConfig): Promise<(...args: any[]) => any> {
  return import(path.join(fluxionOptions.moduleDir, config.modulePath)).then((m) => {
    if (typeof m.default !== 'function') {
      $throw(`The default export of ${config.modulePath} should be a function`);
    }
    return m.default;
  });
}
