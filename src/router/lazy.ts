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

  async getModule(url: URL): Promise<NormalizedModule | undefined> {
    const relativePath = url.pathname.replace(/^[/]+/, '').replace(/[/]+$/, '');
    const m = this.handlers.get(relativePath);

    // Not in cache at all
    if (!m) {
      return undefined;
    }

    // Use the handler's absolutePath to stat the actual file
    const stat = await fs.stat(m.absolutePath).catch(() => undefined);
    if (!stat || !stat.isFile()) {
      const disposer = m.disposer;
      if (disposer) {
        await PromiseTry(disposer);
      }
      this.handlers.delete(relativePath);
      return undefined;
    }

    // When outdated, re-register the module
    if (m.mtimeMs < stat.mtimeMs) {
      const fileRelativePath = path.relative(this.cx.options.dir, m.absolutePath);
      return this.register(m.absolutePath, fileRelativePath, stat);
    }

    return m;
  }
}
