import type { FluxionLogger } from '@/common/logger.js';
import type { FluxionHandler } from './types.js';
import fs from 'node:fs';
import path from 'node:path';

export class FluxtionRouter {
  private readonly handlers: Map<string, FluxionHandler> = new Map();
  private readonly dir: string;
  private readonly logger: FluxionLogger;

  constructor(options: { dir: string; logger: FluxionLogger }) {
    this.dir = options.dir;
    this.logger = options.logger;
  }

  // TODO generate a handler for returning a static file with proper content-type based on the file extension
  staticResource(filepath: string): FluxionHandler {}

  /**
   * 1. Check if the path exists, if not, delete the handler;
   * 2. If it's a ts file, register it as an API, otherwise return the file itself;
   * @param filepaths
   */
  register(filepaths: string[]) {
    for (let i = 0; i < filepaths.length; i++) {
      const filepath = filepaths[i];

      const p = path.join(this.dir, filepath);
      if (!fs.existsSync(p)) {
        this.handlers.delete(filepath);
        return;
      }

      delete require.cache[p];

      // register as api
      if (filepath.endsWith('.ts') || filepath.endsWith('.js')) {
        const handler = require(p);
        if (typeof handler === 'function') {
          this.handlers.set(filepath, handler);
        } else if (typeof handler.default === 'function') {
          this.handlers.set(filepath, handler.default);
        } else if (typeof handler.handler === 'function') {
          this.handlers.set(filepath, handler.handler);
        } else {
          this.logger.error(
            `Invalid handler module '${filepath}', make sure it has a default export or named export called "handler" which is a function`,
          );
        }
        continue;
      }

      // register as static resource
      this.handlers.set(filepath, this.staticResource(filepath));
    }
  }
}
