import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import chokidar from 'chokidar';

import { FluxionWatcherBase, type WatcherContext } from './base.js';

export class FluxionWatcher extends FluxionWatcherBase {
  private watcher: FSWatcher | null = null;

  constructor(cx: WatcherContext) {
    super(cx);
  }

  /**
   * Start watching files with chokidar.
   *
   * Using chokidar provides:
   * - Cross-platform recursive watch support (including Linux/CentOS)
   * - Better event handling and stability
   * - Automatic resource management
   */
  start(): this {
    this.stop();
    this.init();

    this.watcher = chokidar
      .watch(this.directoryPath, {
        // Ignore dotfiles and common ignore patterns
        ignored: /(^|[\/\\])\../,
        // Keep the process running
        persistent: true,
        // Don't emit 'add' events for initial scan
        ignoreInitial: true,
        // Use polling as fallback (helps with some network drives)
        usePolling: false,
        // Atomic writes handling
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        },
      })
      .on('all', (_event, filename) => {
        if (!filename) {
          return;
        }

        const relativePath = path.relative(this.directoryPath, filename);
        this.queueRefresh(relativePath);
      })
      .on('error', (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.cx.logger.error(`Watcher error: ${error.message}`);
        this.cx.logger.error(`Restarting watcher...`);
        this.stop().start();
      })
      .on('ready', () => {
        this.cx.logger.info(`Watcher ready and watching directory: ${this.cx.options.dir}`);
      });

    this.cx.logger.info(`Watcher started on directory: ${this.cx.options.dir}`);
    return this;
  }

  stop(): this {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }

    this.stopCore();
    return this;
  }
}
