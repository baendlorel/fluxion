import http from 'node:http';
import path from 'node:path';

import { ensureDynamicDirectory, listModuleNames } from './dynamic-directory.js';
import { getErrorMessage, logJsonLine } from '../common/logger.js';
import { createModuleRouter, type ModuleSyncReason } from './router.js';
import { sendJson } from './response.js';
import { watchDirectoryDiff } from './watcher.js';

export interface ServerOptions {
  dynamicDirectory: string;
  host: string;
  port: number;
}

/**
 * Start a simple HTTP server and dynamically register routes under `dynamicDirectory`.
 */
export function startServer(options: ServerOptions): http.Server {
  const dynamicDirectory = path.resolve(options.dynamicDirectory);
  ensureDynamicDirectory(dynamicDirectory);
  const moduleRouter = createModuleRouter();

  const syncModules = (reason: ModuleSyncReason): void => {
    moduleRouter.syncModules(listModuleNames(dynamicDirectory), reason);
  };

  try {
    syncModules('startup');
  } catch (error) {
    logJsonLine('ERROR', 'module_sync_failed', {
      reason: 'startup',
      error: getErrorMessage(error),
    });
    throw error;
  }

  const watcher = watchDirectoryDiff(dynamicDirectory, () => {
    try {
      syncModules('watch');
    } catch (error) {
      logJsonLine('ERROR', 'module_sync_failed', {
        reason: 'watch',
        error: getErrorMessage(error),
      });
    }
  });

  const server = http.createServer((req, res) => {
    if (req.url === undefined) {
      sendJson(res, 400, { message: 'Bad Request: req.url is undefined' });
      return;
    }

    moduleRouter.lookup(req, res);
  });

  server.on('close', () => {
    watcher.close();
    logJsonLine('INFO', 'server_closed', {
      host: options.host,
      port: options.port,
    });
  });

  server.listen(options.port, options.host, () => {
    logJsonLine('INFO', 'server_started', {
      host: options.host,
      port: options.port,
      dynamicDirectory,
    });
  });

  return server;
}
