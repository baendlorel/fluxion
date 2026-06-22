import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import chokidar from 'chokidar';

import { FluxionWatcherBase, type WatcherContext } from './base.js';

export class FluxionChokidarWatcher extends FluxionWatcherBase {
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
  async start(): Promise<this> {
    this.stop();
    await this.init();

    const dir = this.cx.options.dir;
    this.watcher = chokidar
      .watch(dir, {
        persistent: true, // Keep the process running
        ignoreInitial: true, // Don't emit 'add' events for initial scan
        usePolling: false, // Use polling as fallback (helps with some network drives)
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        }, // Atomic writes handling
      })
      .on('all', (_event, absolutePath) => {
        if (!absolutePath) {
          return;
        }

        // & `filename` is absolute(Maybe because of watching an absolute path `dir`)
        this.queueUp(absolutePath, path.relative(dir, absolutePath));
      })
      .on('error', (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.cx.logger.error(`Watcher error: ${error.message}`);
        this.cx.logger.error(`Restarting watcher...`);
        this.start();
      })
      .on('ready', () => {
        this.cx.logger.info(`Watcher ready and watching directory: ${dir}`);
      });

    this.cx.logger.info(`Watcher started on directory: ${dir}`);
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
