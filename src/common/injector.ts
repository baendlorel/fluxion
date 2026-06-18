import type { FluxionModule } from '@/types.js';

function isFluxionModule(o: unknown): o is FluxionModule {
  if (typeof o !== 'object' || o === null) {
    return false;
  }

  if (typeof (o as FluxionModule).handler !== 'function') {
    return false;
  }

  if ((o as FluxionModule).disposer !== undefined && typeof (o as FluxionModule).disposer !== 'function') {
    return false;
  }

  return true;
}

export function loadFluxionModule(fullpath: string): FluxionModule {
  delete require.cache[fullpath];
  const m = require(fullpath);
  if (isFluxionModule(m)) {
    return m;
  } else if (isFluxionModule(m.default)) {
    return m.default;
  } else {
    $throw(`Invalid handler module '${fullpath}', make sure it satisfies defineFluxionModule(...) helper`);
  }
}
