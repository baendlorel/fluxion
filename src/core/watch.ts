import fs from 'node:fs';
import type { FluxionContext } from './types.js';

export class FluxionWatcher {
  // # Options
  private readonly cx: Pick<FluxionContext, 'options' | 'logger' | 'router'>;

  private timer: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;
  private readonly filesChanged: Set<string> = new Set();

  constructor(cx: Pick<FluxionContext, 'options' | 'logger' | 'router'>) {
    this.cx = cx;
  }

  /**
   * Since all actions are mapped to `rename` and `change` (WatchEventType).
   *
   * We could only record every file and reload them all.
   */
  start(): this {
    this.watcher = fs
      .watch(this.cx.options.dir, { recursive: true }, (_eventType, filename) => {
        if (!filename) {
          return;
        }

        // FIXME change会触发两次，但我已经做了防抖啊，已经累积为settimeout。
        this.filesChanged.add(filename);
        if (!this.timer) {
          this.timer = setTimeout(() => {
            console.log('fileschanged', this.filesChanged, this.cx.options.reloadDelay);
            this.filesChanged.forEach((p, _, s) => {
              try {
                this.cx.router.register(p);
              } catch (err) {
                this.cx.logger.error(`Error refreshing handlers: ${(err as Error).message}`);
              } finally {
                s.delete(p);
              }
            });

            this.timer = null;
          }, this.cx.options.reloadDelay);
        }
      })
      .on('error', (err) => this.cx.logger.error(`Watcher error: ${err.message}`));

    this.cx.logger.info(`Watcher started on directory: ${this.cx.options.dir}`);
    return this;
  }

  stop(): this {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.filesChanged.clear();
    return this;
  }
}
