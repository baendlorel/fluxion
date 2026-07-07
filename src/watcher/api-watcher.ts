import type { FluxionRouter } from '../router/index.js';
import { FluxionWatcherBase, type WatcherBaseContext, type WatcherCoreConstructor } from './base.js';

export interface ApiWatcherContext extends WatcherBaseContext {
  router: FluxionRouter;
}

/**
 * Watches the API directory and hot-reloads routes on file changes.
 * Replaces the former FluxionChokidarWatcher / FluxionNativeWatcher.
 */
export class ApiWatcher extends FluxionWatcherBase {
  private readonly router: FluxionRouter;

  constructor(cx: ApiWatcherContext, CoreType: WatcherCoreConstructor) {
    super(cx, CoreType);
    this.router = cx.router;
  }

  async onChange(absolutePath: string, relativePath: string): Promise<void> {
    await this.router.register(absolutePath, relativePath);
  }
}
