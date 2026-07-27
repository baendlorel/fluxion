import fs from 'node:fs';
import { minimatch } from 'minimatch';
import { FluxionWatcherBase, type WatcherBaseContext, type WatcherCoreConstructor } from './base.js';
import type { FluxionCronJobManager } from '@/cronjob/manager.js';

export interface CronJobWatcherContext extends WatcherBaseContext {
  cronJobManager: FluxionCronJobManager;
}

/**
 * Watches the cronjob directory and hot-reloads jobs on file changes.
 */
export class CronJobWatcher extends FluxionWatcherBase {
  private readonly manager: FluxionCronJobManager;
  private readonly include: string[];
  private readonly exclude: string[];

  constructor(cx: CronJobWatcherContext, CoreType: WatcherCoreConstructor) {
    if (!cx.options.cronjobDir) {
      _throw('cronjobDir must be given to register a CronJobWatcher');
    }

    super(cx, CoreType, cx.options.cronjobDir);
    this.manager = cx.cronJobManager;
    this.include = cx.options.cronjobInclude;
    this.exclude = cx.options.cronjobExclude;
  }

  async onChange(absolutePath: string, relativePath: string): Promise<void> {
    // File deleted → unregister
    if (!fs.existsSync(absolutePath)) {
      this.manager.unregister(relativePath);
      return;
    }

    // Include/exclude filter
    if (!this.matchesPatterns(relativePath)) {
      return;
    }

    // Reload (import + validate + register)
    await this.manager.reloadModule(relativePath, absolutePath);
  }

  private matchesPatterns(relativePath: string): boolean {
    const included = this.include.some((pattern) => minimatch(relativePath, pattern));
    if (!included) return false;

    const excluded = this.exclude.some((pattern) => minimatch(relativePath, pattern));
    return !excluded;
  }
}
