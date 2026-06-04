import fs from 'node:fs';
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
   *
   * We could only record every file and reload them all.
   */
  start(args: { logger: FluxionLogger; dir: string; refresh: (relativePath: string) => void }) {
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
        this.filesChanged.forEach((p, _, s) => {
          try {
            refresh(p);
          } catch (err) {
            logger.error(`Error refreshing handlers: ${(err as Error).message}`);
          } finally {
            s.delete(p);
          }
        });

        this.timer = null;
      }, this.delay);
    }).on('error', (err) => logger.error(`Watcher error: ${err.message}`));

    logger.info(`Watcher started on directory: ${dir}`);
  }
}
