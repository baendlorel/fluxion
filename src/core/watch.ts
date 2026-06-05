import fs from 'node:fs';
import path from 'node:path';
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
   * Recursively register all files in the options directory.
   */
  private init(): this {
    const dirPath = path.join(process.cwd(), this.cx.options.dir);

    const registerRecursive = (dir: string, relativePath: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        const entryRelativePath = path.join(relativePath, entry.name);

        if (entry.isDirectory()) {
          registerRecursive(entryPath, entryRelativePath);
        } else if (entry.isFile()) {
          try {
            this.cx.router.register(entryRelativePath);
          } catch (err) {
            this.cx.logger.error(`Error registering [${entryRelativePath}]: ${(err as Error).message}`);
          }
        }
      }
    };

    if (fs.existsSync(dirPath)) {
      registerRecursive(dirPath, '');
      this.cx.logger.info(`Initial registration complete for directory: ${this.cx.options.dir}`);
    } else {
      this.cx.logger.warn(`Directory does not exist: ${this.cx.options.dir}`);
    }

    return this;
  }

  /**
   * Since all actions are mapped to `rename` and `change` (WatchEventType).
   *
   * We could only record every file and reload them all.
   */
  start(): this {
    this.init();
    this.watcher = fs
      .watch(this.cx.options.dir, { recursive: true }, (_eventType, filename) => {
        if (!filename) {
          return;
        }

        this.filesChanged.add(filename);
        if (!this.timer) {
          this.timer = setTimeout(() => {
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

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.filesChanged.clear();
    return this;
  }
}
