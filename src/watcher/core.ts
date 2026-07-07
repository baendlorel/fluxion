import fs from 'node:fs';
import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import chokidar from 'chokidar';

export interface WatcherCoreOptions {
  dir: string;
  onFileChanged: (absolutePath: string, relativePath: string) => void;
  onError: (error: Error) => void;
  onReady?: () => void;
}

export abstract class WatcherCore {
  protected readonly options: WatcherCoreOptions;

  constructor(options: WatcherCoreOptions) {
    this.options = options;
  }

  abstract start(): void;
  abstract stop(): void;
}

/**
 * Chokidar-based file watcher core.
 *
 * Provides cross-platform recursive watch support (including Linux/CentOS)
 * with better event handling and stability.
 */
export class FluxionChokidarCore extends WatcherCore {
  private watcher: FSWatcher | null = null;

  start(): void {
    this.stop();

    const { dir, onFileChanged, onError, onReady } = this.options;

    this.watcher = chokidar
      .watch(dir, {
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        },
      })
      .on('all', (_event, absolutePath) => {
        if (!absolutePath) {
          return;
        }
        onFileChanged(absolutePath, path.relative(dir, absolutePath));
      })
      .on('error', (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        onError(error);
      })
      .on('ready', () => {
        onReady?.();
      });
  }

  stop(): void {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
  }
}

/**
 * Native fs.watch-based file watcher core.
 *
 * Uses Node.js built-in fs.watch with recursive option.
 * Lighter weight but less cross-platform reliable than chokidar.
 */
export class FluxionNativeCore extends WatcherCore {
  private watcher: fs.FSWatcher | null = null;

  start(): void {
    this.stop();

    const { dir, onFileChanged, onError } = this.options;

    this.watcher = fs
      .watch(dir, { recursive: true }, (_eventType, relativePath) => {
        if (!relativePath) {
          return;
        }
        onFileChanged(path.join(dir, relativePath), relativePath);
      })
      .on('error', (err) => {
        onError(err);
      });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
