import type { FluxionContext, FluxionModule } from '@/types.js';
import { static_cast } from 'type-narrow';

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

  if (o.handlerTimeoutMs !== undefined && typeof o.handlerTimeoutMs !== 'function') {
    return false;
  }

  return true;
}

export function loadFluxionModule(_cx: Pick<FluxionContext, 'options' | 'logger'>, fullpath: string): FluxionModule {
  delete require.cache[fullpath];
  let m = require(fullpath);
  if (isFluxionModule(m)) {
  } else if (isFluxionModule(m.default)) {
    m = m.default;
  } else {
    $throw(`Invalid handler module '${fullpath}', make sure it satisfies defineFluxionModule(...) helper`);
  }

  return m;
}
