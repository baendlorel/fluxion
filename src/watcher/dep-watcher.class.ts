import type { FSWatcher } from 'node:fs';
import type { NormalizedFluxionOptions } from '@/types.js';
import fs from 'node:fs';
import path from 'node:path';

export class DependencyWatcher {
  private watcher: FSWatcher | null;
  private opts: NormalizedFluxionOptions;

  constructor(opts: NormalizedFluxionOptions) {
    this.opts = opts;
    this.watcher = this.start();
  }

  start(): FSWatcher {
    // No matter what type is, clear the cache
    return fs.watch(this.opts.dir, (_eventType, filename) => {
      // TODO 是static的不管，是exclude的不管，apiinclude的要管
      if (!filename) {
        return;
      }

      // absolute path cache clear
      const absolutePath = path.join(this.opts.dir, filename);
      delete require.cache[absolutePath];

      try {
        for (const p in require.cache) {
          const children = require.cache[p]?.children;
          if (!children) {
            continue;
          }
          // clear the file that imports the changed one.
          if (children.find((v) => v.id === absolutePath)) {
            delete require.cache[p];
          }
        }
      } catch (e) {
        console.error('Error clearing require cache:', e);
      }
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
