import fs from 'node:fs';
import path from 'node:path';
import type { FluxionContext } from '../types.js';

export type WatcherContext = Pick<FluxionContext, 'options' | 'logger' | 'router'>;

export abstract class FluxionWatcherBase {
  protected readonly cx: WatcherContext;

  private timer: NodeJS.Timeout | null = null;
  private readonly filesChanged = new Map<string, string>();

  constructor(cx: WatcherContext) {
    this.cx = cx;
  }

  /**
   * Recursively register all files in the options directory.
   */
  protected init(): this {
    const dir = this.cx.options.dir;
    if (!fs.existsSync(dir)) {
      this.cx.logger.warn(`Directory does not exist: ${dir}`);
      return this;
    }

    const registerRecursive = (absoluteDir: string, relativeDir: string) => {
      const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const absolutePath = path.join(absoluteDir, entry.name);
        const relativePath = path.join(relativeDir, entry.name);

        if (entry.isDirectory()) {
          registerRecursive(absolutePath, relativePath);
        } else if (entry.isFile()) {
          this.register(absolutePath, relativePath);
        }
      }
    };

    registerRecursive(dir, '');
    this.cx.logger.info(`Initial registration complete for directory: ${dir}`);
    return this;
  }

  protected queueUp(absolutePath: string, relativePath: string): void {
    this.filesChanged.set(absolutePath, relativePath);
    if (this.timer) {
      return;
    }

    this.timer = setTimeout(async () => {
      const promises = [...this.filesChanged].map(([absolutePath, relativePath]) =>
        this.cx.router
          .register(absolutePath, relativePath)
          .catch((err) => this.cx.logger.error(`Error refreshing handlers: ${(err as Error).message}`))
          .finally(() => this.filesChanged.delete(absolutePath)),
      );
      await Promise.all(promises);
      this.timer = null;
    }, this.cx.options.reloadDelay);
  }

  protected stopCore(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.filesChanged.clear();
  }

  private register(absolutePath: string, relativePath: string): void {
    try {
      this.cx.router.register(absolutePath, relativePath);
    } catch (err) {
      this.cx.logger.error(`Error refreshing handlers: ${(err as Error).message}`);
    }
  }

  abstract start(): this;
  abstract stop(): this;
}
