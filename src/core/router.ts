import http from 'node:http';

import createRouter from 'find-my-way';

import { API_METHODS } from '../common/consts.js';
import { getErrorMessage, logJsonLine, logOneLine } from '../common/logger.js';
import { createModuleHandlerRuntime } from './module-handler-runtime.js';
import { sendJson } from './response.js';

export type ModuleSyncReason = 'startup' | 'watch';

interface ModuleRoutes {
  moduleName: string;
  rootPath: string;
  wildcardPath: string;
}

interface ModuleRouter {
  lookup: http.RequestListener;
  syncModules: (moduleNames: readonly string[], reason: ModuleSyncReason) => void;
}

function createModuleRoutes(moduleName: string): ModuleRoutes {
  return {
    moduleName,
    rootPath: `/${moduleName}`,
    wildcardPath: `/${moduleName}/*`,
  };
}

function safeSendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  if (res.writableEnded) {
    return;
  }

  if (res.headersSent) {
    res.end();
    return;
  }

  sendJson(res, statusCode, payload);
}

export function createModuleRouter(dynamicDirectory: string): ModuleRouter {
  const router = createRouter({
    defaultRoute(req, res) {
      safeSendJson(res, 404, {
        message: 'Route not found',
        method: req.method,
        url: req.url ?? null,
      });
    },
  });

  const handlerRuntime = createModuleHandlerRuntime(dynamicDirectory);
  const registeredModules = new Map<string, ModuleRoutes>();

  const dispatchModuleRequest = async (
    moduleName: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    try {
      const result = await handlerRuntime.handleRequest(moduleName, req, res);

      if (result === 'not_found') {
        safeSendJson(res, 404, {
          message: 'Handler not found',
          module: moduleName,
          method: req.method,
          url: req.url ?? null,
        });
      }
    } catch (error) {
      logJsonLine('ERROR', 'module_handler_failed', {
        module: moduleName,
        method: req.method,
        url: req.url ?? null,
        error: getErrorMessage(error),
      });

      safeSendJson(res, 500, {
        message: 'Internal Server Error',
        module: moduleName,
      });
    }
  };

  const createRequestHandler = (moduleName: string): http.RequestListener => {
    return (req, res) => {
      void dispatchModuleRequest(moduleName, req, res);
    };
  };

  const registerModule = (moduleName: string): void => {
    if (registeredModules.has(moduleName)) {
      return;
    }

    const routes = createModuleRoutes(moduleName);
    const moduleRequestHandler = createRequestHandler(moduleName);

    for (const method of API_METHODS) {
      router.on(method, routes.rootPath, moduleRequestHandler);
      router.on(method, routes.wildcardPath, moduleRequestHandler);
    }

    registeredModules.set(moduleName, routes);

    logOneLine('INFO', `Registered route: ${routes.rootPath}`);
    logOneLine('INFO', `Registered route: ${routes.wildcardPath}`);
    logJsonLine('INFO', 'module_registered', {
      module: moduleName,
      rootRoute: routes.rootPath,
      wildcardRoute: routes.wildcardPath,
    });
  };

  const unregisterModule = (moduleName: string): void => {
    const routes = registeredModules.get(moduleName);
    if (routes === undefined) {
      return;
    }

    for (const method of API_METHODS) {
      router.off(method, routes.rootPath);
      router.off(method, routes.wildcardPath);
    }

    registeredModules.delete(moduleName);
    handlerRuntime.invalidateModule(moduleName);

    logOneLine('INFO', `Unregistered route: ${routes.rootPath}`);
    logOneLine('INFO', `Unregistered route: ${routes.wildcardPath}`);
    logJsonLine('INFO', 'module_unregistered', {
      module: moduleName,
      rootRoute: routes.rootPath,
      wildcardRoute: routes.wildcardPath,
    });
  };

  const syncModules = (moduleNames: readonly string[], reason: ModuleSyncReason): void => {
    const discoveredModules = new Set(moduleNames);
    const currentModules = new Set(registeredModules.keys());

    const addedModules: string[] = [];
    const removedModules: string[] = [];

    for (const moduleName of discoveredModules) {
      if (!currentModules.has(moduleName)) {
        registerModule(moduleName);
        addedModules.push(moduleName);
      }
    }

    for (const moduleName of currentModules) {
      if (!discoveredModules.has(moduleName)) {
        unregisterModule(moduleName);
        removedModules.push(moduleName);
      }
    }

    if (addedModules.length > 0 || removedModules.length > 0) {
      logJsonLine('INFO', 'module_diff_applied', {
        reason,
        addedModules,
        removedModules,
      });
    }
  };

  return {
    lookup(req, res) {
      router.lookup(req, res);
    },
    syncModules,
  };
}
