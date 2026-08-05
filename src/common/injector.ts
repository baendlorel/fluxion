import type { FluxionContext, NormalizedModule } from '@/types.js';
import { static_cast } from 'type-narrow';
import { FluxionModuleType } from './consts';

function isFluxionModule(cx: Pick<FluxionContext, 'options' | 'logger'>, o: unknown): o is NormalizedModule {
  if (typeof o !== 'object' || o === null) {
    return false;
  }

  static_cast<NormalizedModule>(o);

  if (typeof o.handler !== 'function') {
    cx.logger.error(`handler must be a function`);
    return false;
  }

  if (o.disposer !== undefined && typeof o.disposer !== 'function') {
    cx.logger.error(`disposer must be a function if provided`);
    return false;
  }

  const ms = o.handlerTimeoutMs;
  if (ms !== undefined && (!Number.isSafeInteger(ms) || ms < 100)) {
    cx.logger.error(`handlerTimeoutMs must be an integer >= 100 if provided`);
    return false;
  }

  if (o.type !== FluxionModuleType.Api) {
    cx.logger.error(`You must use defineFluxionModule to create module`);
    return false;
  }

  return true;
}

export function loadFluxionModule(
  cx: Pick<FluxionContext, 'options' | 'logger'>,
  absolutePath: string,
): NormalizedModule {
  delete require.cache[absolutePath];
  let m = require(absolutePath);
  if (isFluxionModule(cx, m.default)) {
    m = m.default;
  } else if (isFluxionModule(cx, m)) {
  } else {
    _throw(`Invalid handler module '${absolutePath}', make sure it satisfies defineFluxionModule(...) helper`);
  }

  m.absolutePath = absolutePath;

  return m;
}
