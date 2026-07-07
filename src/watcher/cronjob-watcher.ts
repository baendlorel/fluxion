import { FluxionWatcherBase, type WatcherBaseContext, type WatcherCoreConstructor } from './base.js';

export interface CronJobManager {
  register(absolutePath: string, relativePath: string): Promise<void>;
  unregister(absolutePath: string): Promise<void>;
}

export interface CronJobWatcherContext extends WatcherBaseContext {
  cronJobManager: CronJobManager;
}

/**
 * Watches the cronjob directory and hot-reloads cron jobs on file changes.
 */
export class CronJobWatcher extends FluxionWatcherBase {
  private readonly manager: CronJobManager;

  constructor(cx: CronJobWatcherContext, CoreType: WatcherCoreConstructor) {
    super(cx, CoreType);
    this.manager = cx.cronJobManager;
  }

  async onChange(absolutePath: string, relativePath: string): Promise<void> {
    // TODO: implement include/exclude matching and loadFluxionCronJob
    // For now, delegate directly to the manager
    await this.manager.register(absolutePath, relativePath);
  }
}
