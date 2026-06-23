import type { FluxionContext, FluxionModule, FluxionModuleWithType } from '@/types.js';
import { static_cast } from 'type-narrow';
import { FluxionModuleType } from './consts';

function isFluxionModule(o: unknown): o is FluxionModule {
  if (typeof o !== 'object' || o === null) {
    return false;
  }

  static_cast<FluxionModule>(o);

  if (typeof o.handler !== 'function') {
    return false;
  }

  if (o.disposer !== undefined && typeof o.disposer !== 'function') {
    return false;
  }

  const ms = o.handlerTimeoutMs;
  if (ms !== undefined && (!Number.isSafeInteger(ms) || ms < 100)) {
    return false;
  }

  return true;
}

export function loadFluxionModule(
  _cx: Pick<FluxionContext, 'options' | 'logger'>,
  fullpath: string,
): FluxionModuleWithType {
  delete require.cache[fullpath];
  let m = require(fullpath);
  if (isFluxionModule(m)) {
  } else if (isFluxionModule(m.default)) {
    m = m.default;
  } else {
    $throw(`Invalid handler module '${fullpath}', make sure it satisfies defineFluxionModule(...) helper`);
  }

  return { ...m, type: FluxionModuleType.Api };
}
