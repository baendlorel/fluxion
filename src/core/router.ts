import http from 'node:http';
import createRouter from 'find-my-way';
import { logJsonLine, logOneLine } from '@/common/logger.js';
import { sendJson } from './response.js';
import { API_METHODS } from '@/common/consts.js';

// type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | (string & {});

export type ModuleSyncReason = 'startup' | 'watch';

interface ModuleRoutes {
  moduleName: string;
  webRootPath: string;
  webWildcardPath: string;
  apiPath: string;
}

interface ModuleRouter {
  lookup: http.RequestListener;
  syncModules: (moduleNames: readonly string[], reason: ModuleSyncReason) => void;
}

function createModuleRoutes(moduleName: string): ModuleRoutes {
  const webRootPath = `/${moduleName}`;

  return {
    moduleName,
    webRootPath,
    webWildcardPath: `${webRootPath}/*`,
    apiPath: `${webRootPath}/api`,
  };
}

export function createModuleRouter(): ModuleRouter {
  const router = createRouter({
    defaultRoute(req, res) {
      sendJson(res, 404, {
        message: 'Route not found',
        method: req.method,
        url: req.url ?? null,
      });
    },
  });

  const registeredModules = new Map<string, ModuleRoutes>();

  const registerModule = (moduleName: string): void => {
    if (registeredModules.has(moduleName)) {
      return;
    }

    const routes = createModuleRoutes(moduleName);

    const webHandler: http.RequestListener = (_req, res) => {
      sendJson(res, 200, {
        module: routes.moduleName,
        routeType: 'web',
        message: 'web route registered (static serving not implemented yet)',
      });
    };

    const apiHandler: http.RequestListener = (_req, res) => {
      sendJson(res, 200, {
        module: routes.moduleName,
        routeType: 'api',
        message: 'api route registered',
      });
    };

    router.on('GET', routes.webRootPath, webHandler);
    router.on('HEAD', routes.webRootPath, webHandler);
    router.on('GET', routes.webWildcardPath, webHandler);
    router.on('HEAD', routes.webWildcardPath, webHandler);

    for (const method of API_METHODS) {
      router.on(method, routes.apiPath, apiHandler);
    }

    registeredModules.set(moduleName, routes);

    logOneLine('INFO', `route registered  : ${routes.webRootPath}/`);
  };

  const unregisterModule = (moduleName: string): void => {
    const routes = registeredModules.get(moduleName);
    if (routes === undefined) {
      return;
    }

    router.off('GET', routes.webRootPath);
    router.off('HEAD', routes.webRootPath);
    router.off('GET', routes.webWildcardPath);
    router.off('HEAD', routes.webWildcardPath);

    for (const method of API_METHODS) {
      router.off(method, routes.apiPath);
    }

    registeredModules.delete(moduleName);
    logOneLine('INFO', `route unregistered: ${routes.webRootPath}/`);
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
