import fs from 'node:fs';
import path from 'node:path';
import type { FluxionContext } from '../types.js';

export type WatcherContext = Pick<FluxionContext, 'options' | 'logger' | 'router'>;

export abstract class FluxionWatcherBase {
  protected readonly cx: WatcherContext;

  private timer: NodeJS.Timeout | null = null;
  private readonly filesChanged: Set<string> = new Set();

  constructor(cx: WatcherContext) {
    this.cx = cx;
  }

  protected getDirectoryPath(): string {
    return path.isAbsolute(this.cx.options.dir) ? this.cx.options.dir : path.join(process.cwd(), this.cx.options.dir);
  }

  /**
   * Recursively register all files in the options directory.
   */
  protected init(): this {
    const dirPath = this.getDirectoryPath();

    const registerRecursive = (dir: string, relativePath: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        const entryRelativePath = path.join(relativePath, entry.name);

        if (entry.isDirectory()) {
          registerRecursive(entryPath, entryRelativePath);
        } else if (entry.isFile()) {
          this.register(entryRelativePath);
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

  protected queueRefresh(filepath: string): void {
    this.filesChanged.add(filepath);
    if (this.timer) {
      return;
    }

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

  protected stopCore(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.filesChanged.clear();
  }

  private register(filepath: string): void {
    try {
      this.cx.router.register(filepath);
    } catch (err) {
      this.cx.logger.error(`Error registering [${filepath}]: ${(err as Error).message}`);
    }
  }

  abstract start(): this;
  abstract stop(): this;
}
