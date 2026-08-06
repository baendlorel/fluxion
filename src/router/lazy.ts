import type { NormalizedModule } from '../types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { loadFluxionModule } from '@/common/injector.js';
import { PromiseTry } from '@/common/promise-try.js';

import { FluxionRouterBase } from './base.js';

// # Used by lazy mode
export class FluxionRouter extends FluxionRouterBase {
  async register(absolutePath: string, relativePath: string): Promise<NormalizedModule | undefined> {
    // Step 1: Check if the file exists first
    const fileStat = await fs.stat(absolutePath).catch(() => undefined);
    if (!fileStat?.isFile()) {
      // Run disposer and delete from cache
      const ext = path.extname(relativePath);
      const handlerPath = ext ? relativePath.slice(0, -ext.length) : relativePath;
      const disposer = this.handlers.get(handlerPath)?.disposer;
      if (disposer) {
        await PromiseTry(disposer);
      }
      this.handlers.delete(handlerPath);
      this.cx.logger.core({ action: 'Delete', url: handlerPath });
      return undefined;
    }

    // Step 2: Check if file matches exclude patterns
    // If matching, skip registration
    const matchesExclude = this.cx.options.exclude.some((p) => minimatch(relativePath, p));
    if (matchesExclude) {
      this.handlers.delete(relativePath);
      this.cx.logger.core({ action: 'Exclude', url: relativePath });
      return;
    }

    // Step 3: Check if file matches apiInclude patterns
    // If matching, register as API handler
    const matchesApiInclude = this.cx.options.apiInclude.some((p) => minimatch(relativePath, p));
    if (matchesApiInclude) {
      const m = loadFluxionModule(this.cx, absolutePath);
      const ext = path.extname(relativePath);
      const apiPath = ext ? relativePath.slice(0, -ext.length) : relativePath;
      const stat = await fs.stat(absolutePath).catch(() => undefined);
      m.mtimeMs = stat?.mtimeMs ?? 0;
      this.handlers.set(apiPath, m);
      this.cx.logger.core({ action: 'RegisterApi', url: apiPath });
      return m;
    }

    // Step 4: Check if file matches staticInclude patterns
    // If matching, register as static resource
    const matchesStaticInclude = this.cx.options.staticInclude.some((p) => minimatch(relativePath, p));
    if (matchesStaticInclude) {
      const staticModule = await this.makeStaticResource(absolutePath);
      this.handlers.set(relativePath, staticModule);
      this.cx.logger.core({ action: 'RegisterStatic', url: relativePath });
      return staticModule;
    }

    // Step 5: File doesn't match any pattern, skip registration
    this.handlers.delete(relativePath);
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
      return this.register(m.absolutePath, fileRelativePath);
    }

    return m;
  }
}
