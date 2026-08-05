import type { NormalizedModule, FluxionRouteMeta } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { FluxionModuleType } from '@/common/consts.js';
import { loadFluxionModule } from '@/common/injector.js';
import { PromiseTry } from '@/common/promise-try.js';

import { FluxionRouterBase } from './base.js';

// # Used by lazy mode
export class FluxionRouter extends FluxionRouterBase {
  async register(absolutePath: string, relativePath: string) {
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
      return;
    }

    // Step 2: Check if file matches exclude patterns
    // If matching, skip registration
    const matchesExclude = this.cx.options.exclude.some((pattern) => minimatch(relativePath, pattern));
    if (matchesExclude) {
      this.handlers.delete(relativePath);
      this.cx.logger.core({ action: 'Exclude', url: relativePath });
      return;
    }

    // Step 3: Check if file matches apiInclude patterns
    // If matching, register as API handler
    const matchesApiInclude = this.cx.options.apiInclude.some((pattern) => minimatch(relativePath, pattern));
    if (matchesApiInclude) {
      const m = loadFluxionModule(this.cx, absolutePath);
      const apiPath = this.cx.options.apiMapper(relativePath);
      this.handlers.set(apiPath, m);
      this.cx.logger.core({ action: 'RegisterApi', url: apiPath });
      return;
    }

    // Step 4: Check if file matches staticInclude patterns
    // If matching, register as static resource
    const matchesStaticInclude = this.cx.options.staticInclude.some((pattern) => minimatch(relativePath, pattern));
    if (matchesStaticInclude) {
      this.handlers.set(relativePath, this.makeStaticResource(absolutePath));
      this.cx.logger.core({ action: 'RegisterStatic', url: relativePath });
      return;
    }

    // Step 5: File doesn't match any pattern, skip registration
    this.handlers.delete(handlerPath);
    this.cx.logger.core({ action: 'Skip', url: handlerPath });
  }

  getModule(url: URL): NormalizedModule | undefined {
    const relativePath = url.pathname.replace(/^[/]+/, '').replace(/[/]+$/, '');
    return this.handlers.get(relativePath);
  }

  getRoutes(): FluxionRouteMeta[] {
    return [...this.handlers.entries()]
      .map(
        ([relativePath, m]): FluxionRouteMeta => ({
          path: '/' + relativePath,
          type: m.type === FluxionModuleType.Api ? 'api' : 'static',
          methods: m.methods ? [...m.methods] : null,
        }),
      )
      .sort((a, b) => a.path.localeCompare(b.path));
  }
}
