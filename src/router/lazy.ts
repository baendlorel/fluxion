import type { NormalizedModule } from '../types.js';
import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { loadFluxionModule } from '@/common/injector.js';
import { PromiseTry } from '@/common/promise-try.js';

import { FluxionRouterBase } from './base.js';

// # Used by lazy mode
export class FluxionRouter extends FluxionRouterBase {
  async register(absolutePath: string, relativePath: string, stat: Stats): Promise<NormalizedModule | undefined> {
    // Step 1: Check if file matches exclude patterns
    // If matching, skip registration
    const excluded = this.cx.options.exclude.some((p) => minimatch(relativePath, p));
    if (excluded) {
      this.cx.logger.core({ action: 'Exclude', url: relativePath });
      return;
    }

    // Step 2: Check if file matches apiInclude patterns
    // If matching, register as API handler
    const apiIncluded = this.cx.options.apiInclude.some((p) => minimatch(relativePath, p));
    if (apiIncluded) {
      const apiModule = loadFluxionModule(this.cx, absolutePath, stat);
      this.handlers.set(relativePath, apiModule);
      this.cx.logger.core({ action: 'RegisterApi', url: relativePath });
      return apiModule;
    }

    // Step 3: Check if file matches staticInclude patterns
    // If matching, register as static resource
    const staticIncluded = this.cx.options.staticInclude.some((p) => minimatch(relativePath, p));
    if (staticIncluded) {
      const staticModule = await this.makeStaticResource(absolutePath);
      this.handlers.set(relativePath, staticModule);
      this.cx.logger.core({ action: 'RegisterStatic', url: relativePath });
      return staticModule;
    }

    this.cx.logger.core({ action: 'Skip', url: relativePath });
    return undefined;
  }

  async get(url: URL): Promise<NormalizedModule | undefined> {
    const relativePath = url.pathname.replace(/^[/]+/, '').replace(/[/]+$/, '');
    const absolutePath = path.join(this.cx.options.dir, relativePath);

    // ! Fail if the resolved path escapes the configured directory
    if (!absolutePath.startsWith(this.cx.options.dir + path.sep)) {
      return undefined;
    }

    const cached = this.handlers.get(relativePath);
    const stat = await fs.stat(absolutePath).catch(() => undefined);

    // File does not exist or is not a file, returns undefined.
    if (!stat || !stat.isFile()) {
      if (cached?.disposer) {
        this.handlers.delete(relativePath);
        await PromiseTry(cached.disposer);
      }
      return undefined;
    }

    if (cached?.mtimeMs === stat.mtimeMs) {
      return cached;
    }

    return this.register(absolutePath, relativePath, stat);
  }
}
