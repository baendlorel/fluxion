import type { FSWatcher } from 'node:fs';
import type { NormalizedFluxionOptions } from '@/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';

const DEBOUNCE_MS = 1000;

export class DependencyWatcher {
  private opts: NormalizedFluxionOptions;

  // require.cache is keyed by real path, so resolve symlinks of `dir` once
  private watcher: FSWatcher | null;
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: NormalizedFluxionOptions) {
    this.opts = opts;
    this.watcher = this.start();
  }

  start(): FSWatcher {
    // `recursive` is required, otherwise changes in sub directories are never reported
    return fs.watch(this.opts.dir, { recursive: true }, (_eventType, filename) => {
      if (!filename) {
        return;
      }

      // Same precedence as the router: exclude > apiInclude > staticInclude.
      // Excluded and static files are never `require`d, so there is no cache to clear.
      const relativePath = filename.split(path.sep).join('/');
      if (this.opts.exclude.some((p) => minimatch(relativePath, p))) {
        return;
      }
      if (!this.opts.apiInclude.some((p) => minimatch(relativePath, p))) {
        return;
      }

      this.pending.add(path.join(this.opts.dir, filename));
      this.schedule();
    });
  }

  // Debounce: every new change restarts the timer, clean only after DEBOUNCE_MS of silence
  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.findDeps().forEach((id) => delete require.cache[id]);
      } catch (e) {
        console.error('Error clearing require cache:', e);
      }
    }, DEBOUNCE_MS);
  }

  /**
   * Collect the changed modules in `pending` plus every module that (transitively) imports them,
   * otherwise an importer's parent would keep holding the stale copy. Empties `pending`.
   */
  private findDeps() {
    const stale = new Set<string>(this.pending);
    this.pending.clear();

    // Build the reverse graph (child -> importers) once, then walk it breadth-first
    const importers = new Map<string, string[]>();
    for (const id in require.cache) {
      for (const c of require.cache[id]?.children ?? []) {
        const list = importers.get(c.id);
        if (list) {
          list.push(id);
        } else {
          importers.set(c.id, [id]);
        }
      }
    }

    const queue = [...stale];
    for (const id of queue) {
      for (const parent of importers.get(id) ?? []) {
        if (!stale.has(parent)) {
          stale.add(parent);
          queue.push(parent);
        }
      }
    }
    return stale;
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
