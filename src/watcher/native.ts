import fs from 'node:fs';
import path from 'node:path';

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
  async start(): Promise<this> {
    this.stop();
    await this.init();

    const dir = this.cx.options.dir;
    this.watcher = fs
      .watch(dir, { recursive: true }, (_eventType, relativePath) => {
        if (!relativePath) {
          return;
        }

        // & Unlike chokidar, `filename` here is relativePath
        this.queueUp(path.join(dir, relativePath), relativePath);
      })
      .on('error', (err) => {
        this.cx.logger.error(`Watcher error: ${err.message}`);
        this.cx.logger.error(`Restarting watcher...`);
        this.stop().start();
      });

    this.cx.logger.info(`Watcher started on directory: ${dir}`);
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
