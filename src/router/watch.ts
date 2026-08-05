import type { NormalizedModule } from '../types.js';
import fs from 'node:fs';
import { minimatch } from 'minimatch';
import { loadFluxionModule } from '@/common/injector.js';
import { PromiseTry } from '@/common/promise-try.js';

import { FluxionRouterBase } from './base.js';

// # Used by watcher mode
export class FluxionRouter extends FluxionRouterBase {
  async register(absolutePath: string, relativePath: string): Promise<NormalizedModule | undefined> {
    // Determine the path to use for handler lookup/deletion
    // For API files, this might be transformed by apiMapper
    const isApiFile = this.cx.options.apiInclude.some((pattern) => minimatch(relativePath, pattern));
    const handlerPath = isApiFile ? this.cx.options.apiMapper(relativePath) : relativePath;

    // Get the disposer and delete
    const disposer = this.handlers.get(handlerPath)?.disposer;
    if (disposer) {
      await PromiseTry(disposer);
    }

    // # Delete
    if (!fs.existsSync(absolutePath)) {
      this.handlers.delete(handlerPath);
      this.cx.logger.core({ action: 'Delete', url: handlerPath });
      return undefined;
    }

    // Step 2: Check if file matches exclude patterns
    // If matching, skip registration
    const matchesExclude = this.cx.options.exclude.some((pattern) => minimatch(relativePath, pattern));
    if (matchesExclude) {
      this.handlers.delete(relativePath);
      this.cx.logger.core({ action: 'Exclude', url: relativePath });
      return undefined;
    }

    // Step 3: Check if file matches apiInclude patterns
    // If matching, register as API handler
    const matchesApiInclude = this.cx.options.apiInclude.some((pattern) => minimatch(relativePath, pattern));
    if (matchesApiInclude) {
      const m = loadFluxionModule(this.cx, absolutePath);
      const apiPath = this.cx.options.apiMapper(relativePath);
      this.handlers.set(apiPath, m);
      this.cx.logger.core({ action: 'RegisterApi', url: apiPath });
      return m;
    }

    // Step 4: Check if file matches staticInclude patterns
    // If matching, register as static resource
    const matchesStaticInclude = this.cx.options.staticInclude.some((pattern) => minimatch(relativePath, pattern));
    if (matchesStaticInclude) {
      const staticModule = await this.makeStaticResource(absolutePath);
      this.handlers.set(relativePath, staticModule);
      this.cx.logger.core({ action: 'RegisterStatic', url: relativePath });
      return staticModule;
    }

    // Step 5: File doesn't match any pattern, skip registration
    this.handlers.delete(handlerPath);
    this.cx.logger.core({ action: 'Skip', url: handlerPath });
    return undefined;
  }

  getModule(url: URL): NormalizedModule | undefined {
    const relativePath = url.pathname.replace(/^[/]+/, '').replace(/[/]+$/, '');
    return this.handlers.get(relativePath);
  }
}
