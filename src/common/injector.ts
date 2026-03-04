import type { InjectionConfig } from '@/common/types.js';

export function loadFunction(config: InjectionConfig): Promise<Function> {
  return import(config.modulePath).then((m) => {
    if (typeof m.default !== 'function') {
      $throw(`The default export of ${config.modulePath} should be a function`);
    }
    return m.default;
  });
}
