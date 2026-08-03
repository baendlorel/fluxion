import fs from 'node:fs';
import path from 'node:path';
import type { FluxionContext, FluxionOptions, NormalizedFluxionOptions } from './types.js';

import { createLogger } from './common/logger.js';
import { OPTIONS_NORMALIZED_FLAG } from './common/consts.js';
import { defineFluxionOptions } from './defines/options.js';
import { createServer } from './http/server.js';
import { FluxionRouter } from './router/index.js';

/**
 * Scan the dynamic directory once and register all matching files.
 * This is the one-time eager registration at startup. Hot reload after
 * startup is handled by the lazy-load mechanism (per-request), not by
 * file watchers.
 */
async function scanAndRegister(cx: FluxionContext, dir: string, base: string): Promise<void> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(base, absolutePath);
    if (entry.isDirectory()) {
      await scanAndRegister(cx, absolutePath, base);
    } else if (entry.isFile()) {
      await cx.router.register(absolutePath, relativePath);
    }
  }
}

export async function fluxion(options: FluxionOptions | NormalizedFluxionOptions) {
  const alreadyNormalized = (options as NormalizedFluxionOptions).normalizedFlag === OPTIONS_NORMALIZED_FLAG;
  const context = { options: alreadyNormalized ? options : defineFluxionOptions(options) } as FluxionContext;

  context.logger = createLogger(context as Pick<FluxionContext, 'options'>);
  context.router = new FluxionRouter(context as Pick<FluxionContext, 'options' | 'logger'>);

  // One-time eager registration of existing files.
  await scanAndRegister(context, context.options.dir, context.options.dir);

  // Start HTTP server
  const server = await createServer(context);

  // Register signal handlers for graceful shutdown
  const shutdown = (signal: NodeJS.Signals) => {
    context.logger.warn({ message: 'ShuttingDown', pid: process.pid, signal });
    server.close(() => process.exit(0));
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}
