import fs from 'node:fs';
import path from 'node:path';
import type { FluxionContext } from '@/types.js';
import { type WatcherCoreOptions, WatcherCore } from './core.js';

export type WatcherBaseContext = Pick<FluxionContext, 'logger' | 'options'>;

/**
 * Core constructor type — subclasses pass a WatcherCore subclass constructor.
 */
export type WatcherCoreConstructor = new (options: WatcherCoreOptions) => WatcherCore;

export abstract class FluxionWatcherBase {
  protected readonly cx: WatcherBaseContext;
  protected readonly watchDir: string;
  private readonly core: WatcherCore;

  private timer: NodeJS.Timeout | null = null;
  private readonly filesChanged = new Map<string, string>();

  constructor(cx: WatcherBaseContext, CoreType: WatcherCoreConstructor, watchDir: string) {
    this.cx = cx;
    this.watchDir = watchDir;

    // Core constructor only stores options; callbacks are invoked later,
    // after super() returns and all base class fields are initialized.
    this.core = new CoreType({
      dir: this.watchDir,
      onFileChanged: (absolutePath: string, relativePath: string) => this.queueUp(absolutePath, relativePath),
      onError: (error: Error) => {
        this.cx.logger.error(`Watcher error: ${error.message}`);
        this.cx.logger.error(`Restarting watcher...`);
        this.start();
      },
      onReady: () => {
        this.cx.logger.info(`Watcher ready and watching directory: ${this.watchDir}`);
      },
    });
  }

  /**
   * Recursively scan the directory and call onChange for each file.
   */
  protected async init(): Promise<this> {
    const dir = this.watchDir;
    if (!fs.existsSync(dir)) {
      this.cx.logger.warn(`Directory does not exist: ${dir}`);
      return this;
    }

    const registerList: Array<Promise<void>> = [];

    const registerRecursive = (absoluteDir: string, relativeDir: string) => {
      const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const absolutePath = path.join(absoluteDir, entry.name);
        const relativePath = path.join(relativeDir, entry.name);

        if (entry.isDirectory()) {
          registerRecursive(absolutePath, relativePath);
        } else if (entry.isFile()) {
          const p = this.onChange(absolutePath, relativePath).catch((e) => {
            this.cx.logger.error(`Error registering file ${relativePath}: ${(e as Error).message}`);
          });
          registerList.push(p);
        }
      }
    };

    registerRecursive(dir, '');
    await Promise.all(registerList);

    this.cx.logger.info(`Initial registration complete for directory: ${dir}`);
    return this;
  }

  /**
   * Debounced file change handler. Batches changes within the reloadDelay window.
   */
  protected queueUp(absolutePath: string, relativePath: string): void {
    this.filesChanged.set(absolutePath, relativePath);
    if (this.timer) {
      return;
    }

    this.timer = setTimeout(async () => {
      const promises = [...this.filesChanged].map(([abs, rel]) =>
        this.onChange(abs, rel)
          .catch((err) => this.cx.logger.error(`Error refreshing handlers: ${(err as Error).message}`))
          .finally(() => this.filesChanged.delete(abs)),
      );
      await Promise.all(promises);
      this.timer = null;
    }, this.cx.options.reloadDelay);
  }

  /**
   * Subclasses implement this to define what happens when a file changes.
   */
  abstract onChange(absolutePath: string, relativePath: string): Promise<void>;

  async start(): Promise<this> {
    this.stop();
    await this.init();
    this.core.start();
    return this;
  }

  stop(): this {
    this.core.stop();
    this.stopCore();
    return this;
  }

  protected stopCore(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.filesChanged.clear();
  }
}
