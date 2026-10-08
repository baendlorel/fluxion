import type { FluxionContext, NormalizedModule } from '@/types.js';
import { Stats } from 'node:fs';
import { static_cast } from 'type-narrow';
import { FluxionModuleType } from './consts.js';

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

/**
 * Evict the module and every dependency recorded in `module.children` from require cache,
 * so the whole import chain is re-evaluated on next require. Packages under node_modules are kept.
 */
function purgeRequireCache(absolutePath: string) {
  const visited = new Set<string>();
  const walk = (m: NodeJS.Module | undefined) => {
    if (!m || visited.has(m.id)) {
      return;
    }
    visited.add(m.id);
    for (const child of m.children) {
      if (!child.id.includes('/node_modules/') && !child.id.includes('\\node_modules\\')) {
        walk(child);
      }
    }
  };
  walk(require.cache[absolutePath]);
  visited.add(absolutePath);
  for (const id of visited) {
    delete require.cache[id];
  }
}

export function loadFluxionModule(
  cx: Pick<FluxionContext, 'options' | 'logger'>,
  absolutePath: string,
  stat: Stats,
): NormalizedModule {
  purgeRequireCache(absolutePath);
  let m = require(absolutePath);
  if (isFluxionModule(cx, m.default)) {
    m = m.default;
  } else if (isFluxionModule(cx, m)) {
  } else {
    _throw(`Invalid handler module '${absolutePath}', make sure it satisfies defineFluxionModule(...) helper`);
  }

  m.absolutePath = absolutePath;
  m.mtimeMs = stat.mtimeMs;

  return m;
}
