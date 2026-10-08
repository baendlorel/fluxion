import type { FluxionContext, NormalizedModule } from '@/types.js';
import { statSync, type Stats } from 'node:fs';
import fs from 'node:fs/promises';
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

const isPackage = (filename: string) => filename.includes('/node_modules/') || filename.includes('\\node_modules\\');

const statMtime = (filename: string) => {
  try {
    return statSync(filename).mtimeMs;
  } catch {
    return -1;
  }
};

/**
 * Every file of a handler's import chain (the handler itself included), as loaded.
 * Keyed by handler path, then by file path. Packages under node_modules are not tracked.
 */
const chains = new Map<string, Map<string, NodeJS.Module>>();

/**
 * mtime of a module's file at the time it was loaded.
 */
const loadedMtimes = new WeakMap<NodeJS.Module, number>();

function recordChain(absolutePath: string, mtimeMs: number) {
  const entry = require.cache[absolutePath];
  if (!entry) {
    return;
  }

  const chain = new Map<string, NodeJS.Module>();
  const walk = (m: NodeJS.Module) => {
    if (chain.has(m.filename)) {
      return;
    }
    chain.set(m.filename, m);
    if (!loadedMtimes.has(m)) {
      loadedMtimes.set(m, statMtime(m.filename));
    }
    for (const child of m.children) {
      if (!isPackage(child.filename)) {
        walk(child);
      }
    }
  };
  walk(entry);
  loadedMtimes.set(entry, mtimeMs);
  chains.set(absolutePath, chain);
}

/**
 * Whether anything in the handler's import chain differs from what it was loaded with:
 * a file changed on disk, or a module was evicted/replaced (e.g. because a shared dependency was reloaded).
 */
export async function isFluxionModuleStale(absolutePath: string): Promise<boolean> {
  const chain = chains.get(absolutePath);
  if (!chain) {
    return true;
  }

  const results = await Promise.all(
    [...chain].map(async ([filename, m]) => {
      if (require.cache[filename] !== m) {
        return true;
      }
      const stat = await fs.stat(filename).catch(() => undefined);
      return stat?.mtimeMs !== loadedMtimes.get(m);
    }),
  );
  return results.some(Boolean);
}

/**
 * Evict from require cache:
 * 1. the handler and its whole import chain (`module.children`, recursively),
 * 2. cached files of its recorded chain that changed on disk since they were loaded,
 * 3. every tracked module that depends on any of the above, so no one keeps a stale instance.
 * Packages under node_modules are kept.
 *
 * Evicted modules are also dropped from the `children` of modules that stay cached,
 * otherwise every reload would leave the stale module (and its exports) reachable forever.
 */
function purgeRequireCache(absolutePath: string) {
  const targets = new Set<string>([absolutePath]);

  const visited = new Set<NodeJS.Module>();
  const walk = (m: NodeJS.Module | undefined) => {
    if (!m || visited.has(m)) {
      return;
    }
    visited.add(m);
    targets.add(m.filename);
    for (const child of m.children) {
      if (!isPackage(child.filename)) {
        walk(child);
      }
    }
  };
  walk(require.cache[absolutePath]);

  for (const filename of chains.get(absolutePath)?.keys() ?? []) {
    const m = require.cache[filename];
    if (m && loadedMtimes.has(m) && statMtime(filename) !== loadedMtimes.get(m)) {
      targets.add(filename);
    }
  }

  const tracked = new Set<string>();
  for (const [entry, chain] of chains) {
    tracked.add(entry);
    chain.forEach((_, filename) => tracked.add(filename));
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const filename of tracked) {
      if (targets.has(filename)) {
        continue;
      }
      const chain = chains.get(filename);
      const dependsOnTarget =
        require.cache[filename]?.children.some((c) => targets.has(c.filename)) ||
        (chain !== undefined && [...chain.keys()].some((f) => targets.has(f)));
      if (dependsOnTarget) {
        targets.add(filename);
        grew = true;
      }
    }
  }

  for (const filename of targets) {
    delete require.cache[filename];
  }
  for (const m of Object.values(require.cache)) {
    if (m && m.children.some((c) => targets.has(c.filename))) {
      m.children = m.children.filter((c) => !targets.has(c.filename));
    }
  }
}

/**
 * Node registers every freshly loaded module in `parent.children`, here the loader itself,
 * which would accumulate one stale module per reload.
 */
function detachFromParent(absolutePath: string) {
  const loaded = require.cache[absolutePath];
  const siblings = loaded?.parent?.children;
  const index = siblings?.indexOf(loaded!) ?? -1;
  if (index !== -1) {
    siblings!.splice(index, 1);
  }
}

/**
 * Evict a handler (and what depends on it) from require cache and stop tracking it.
 */
export function unloadFluxionModule(absolutePath: string) {
  purgeRequireCache(absolutePath);
  chains.delete(absolutePath);
}

export function loadFluxionModule(
  cx: Pick<FluxionContext, 'options' | 'logger'>,
  absolutePath: string,
  stat: Stats,
): NormalizedModule {
  purgeRequireCache(absolutePath);
  let m = require(absolutePath);
  recordChain(absolutePath, stat.mtimeMs);
  detachFromParent(absolutePath);
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
