import fs from 'node:fs';

import { FluxionWatcherBase, type WatcherContext } from './base.js';

export class FluxionNativeWatcher extends FluxionWatcherBase {
  private watcher: fs.FSWatcher | null = null;

  constructor(cx: WatcherContext) {
    super(cx);
  }

  /**
   * Since all actions are mapped to `rename` and `change` (WatchEventType).
   *
   * We could only record every file and reload them all.
   */
  start(): this {
    this.stop();
    this.init();

    this.watcher = fs
      .watch(this.getDirectoryPath(), { recursive: true }, (_eventType, filename) => {
        if (!filename) {
          return;
        }

        this.queueRefresh(String(filename));
      })
      .on('error', (err) => {
        this.cx.logger.error(`Watcher error: ${err.message}`);
        this.cx.logger.error(`Restarting watcher...`);
        this.stop().start();
      });

    this.cx.logger.info(`Watcher started on directory: ${this.cx.options.dir}`);
    return this;
  }

  stop(): this {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.stopCore();
    return this;
  }
}
