import fs from 'node:fs';
import path from 'node:path';
import type { FluxionLogger } from '@/common/logger.js';

// const watched = path.join('dist');
// fs.watch(watched, { recursive: true }, (eventType, filename) => {
//   console.log(`[${new Date().toISOString()}] ${eventType} - ${filename}`);
// });

export class FluxionWatcher {
  private timer: NodeJS.Timeout | null = null;
  private readonly delay: number;
  private readonly filesChanged: Set<string> = new Set();

  constructor(delay = 300) {
    this.delay = delay;
  }

  /**
   * Since all actions are mapped to `rename` and `change` (WatchEventType).
   * We could only record every file and reload them all.
   */
  start(args: { logger: FluxionLogger; dir: string; refresh: (filepath: string) => void }) {
    const { logger, dir, refresh } = args;
    fs.watch(dir, { recursive: true }, (_eventType, filename) => {
      if (!filename) {
        return;
      }

      this.filesChanged.add(filename);
      if (this.timer) {
        return;
      }

      this.timer = setTimeout(() => {
        this.filesChanged.forEach(refresh);
        this.filesChanged.clear();
        this.timer = null;
      }, this.delay);
    });
    logger.info(`Watcher started on directory: ${dir}`);
  }
}
