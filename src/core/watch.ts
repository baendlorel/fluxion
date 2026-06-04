import fs from 'node:fs';
import type { FluxionLogger } from '@/common/logger.js';

// const watched = path.join('dist');
// fs.watch(watched, { recursive: true }, (eventType, filename) => {
//   console.log(`[${new Date().toISOString()}] ${eventType} - ${filename}`);
// });

export class FluxionWatcher {
  // # Options
  private readonly delay: number;
  private readonly logger: FluxionLogger;
  private readonly dir: string;
  private readonly refresh: (relativePath: string) => void;

  private timer: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;
  private readonly filesChanged: Set<string> = new Set();

  constructor(options: { delay: number; logger: FluxionLogger; dir: string; refresh: (relativePath: string) => void }) {
    this.delay = options.delay;
    this.logger = options.logger;
    this.dir = options.dir;
    this.refresh = options.refresh;
  }

  /**
   * Since all actions are mapped to `rename` and `change` (WatchEventType).
   *
   * We could only record every file and reload them all.
   */
  start() {
    this.watcher = fs
      .watch(this.dir, { recursive: true }, (_eventType, filename) => {
        if (!filename) {
          return;
        }

        this.filesChanged.add(filename);
        if (!this.timer) {
          this.timer = setTimeout(() => {
            this.filesChanged.forEach((p, _, s) => {
              try {
                this.refresh(p);
              } catch (err) {
                this.logger.error(`Error refreshing handlers: ${(err as Error).message}`);
              } finally {
                s.delete(p);
              }
            });

            this.timer = null;
          }, this.delay);
        }
      })
      .on('error', (err) => this.logger.error(`Watcher error: ${err.message}`));

    this.logger.info(`Watcher started on directory: ${this.dir}`);
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.filesChanged.clear();
  }
}
