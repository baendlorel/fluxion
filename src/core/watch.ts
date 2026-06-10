import fs from 'node:fs';
import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import type { FluxionContext } from './types.js';
import chokidar from 'chokidar';

export class FluxionWatcher {
  // # Options
  private readonly cx: Pick<FluxionContext, 'options' | 'logger' | 'router'>;

  private timer: NodeJS.Timeout | null = null;
  private watcher: FSWatcher | null = null;
  private readonly filesChanged: Set<string> = new Set();

  constructor(cx: Pick<FluxionContext, 'options' | 'logger' | 'router'>) {
    this.cx = cx;
  }

  /**
   * Recursively register all files in the options directory.
   */
  private init(): this {
    const dirPath = path.isAbsolute(this.cx.options.dir)
      ? this.cx.options.dir
      : path.join(process.cwd(), this.cx.options.dir);

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
   * Start watching files with chokidar.
   *
   * Using chokidar provides:
   * - Cross-platform recursive watch support (including Linux/CentOS)
   * - Better event handling and stability
   * - Automatic resource management
   */
  start(): this {
    this.init();

    const dirPath = path.isAbsolute(this.cx.options.dir)
      ? this.cx.options.dir
      : path.join(process.cwd(), this.cx.options.dir);

    this.watcher = chokidar
      .watch(dirPath, {
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

        // Calculate relative path
        const relativePath = path.relative(dirPath, filename);

        this.filesChanged.add(relativePath);
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
