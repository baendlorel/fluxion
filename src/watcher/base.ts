import fs from 'node:fs';
import path from 'node:path';
import type { FluxionLogger } from '../common/logger.js';
import { type WatcherCoreOptions, WatcherCore } from './core.js';

export interface WatcherBaseContext {
  options: { dir: string; reloadDelay: number };
  logger: FluxionLogger;
}

/**
 * Core constructor type — subclasses pass a WatcherCore subclass constructor.
 */
export type WatcherCoreConstructor = new (options: WatcherCoreOptions) => WatcherCore;

export abstract class FluxionWatcherBase {
  protected readonly dir: string;
  protected readonly reloadDelay: number;
  protected readonly logger: FluxionLogger;
  private readonly core: WatcherCore;

  private timer: NodeJS.Timeout | null = null;
  private readonly filesChanged = new Map<string, string>();

  constructor(cx: WatcherBaseContext, CoreType: WatcherCoreConstructor) {
    this.dir = cx.options.dir;
    this.reloadDelay = cx.options.reloadDelay;
    this.logger = cx.logger;

    // Core constructor only stores options; callbacks are invoked later,
    // after super() returns and all base class fields are initialized.
    this.core = new CoreType({
      dir: this.dir,
      onFileChanged: (absolutePath: string, relativePath: string) => this.queueUp(absolutePath, relativePath),
      onError: (error: Error) => {
        this.logger.error(`Watcher error: ${error.message}`);
        this.logger.error(`Restarting watcher...`);
        this.start();
      },
      onReady: () => {
        this.logger.info(`Watcher ready and watching directory: ${this.dir}`);
      },
    });
  }

  /**
   * Recursively scan the directory and call onChange for each file.
   */
  protected async init(): Promise<this> {
    const dir = this.dir;
    if (!fs.existsSync(dir)) {
      this.logger.warn(`Directory does not exist: ${dir}`);
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
            this.logger.error(`Error registering file ${relativePath}: ${(e as Error).message}`);
          });
          registerList.push(p);
        }
      }
    };

    registerRecursive(dir, '');
    await Promise.all(registerList);

    this.logger.info(`Initial registration complete for directory: ${dir}`);
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
          .catch((err) => this.logger.error(`Error refreshing handlers: ${(err as Error).message}`))
          .finally(() => this.filesChanged.delete(abs)),
      );
      await Promise.all(promises);
      this.timer = null;
    }, this.reloadDelay);
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
