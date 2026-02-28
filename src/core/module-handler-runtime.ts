import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type ModuleDefaultHandler = (req: http.IncomingMessage, res: http.ServerResponse) => unknown;

type ModuleHandleResult = 'handled' | 'not_found';

interface HandlerCacheEntry {
  version: string;
  handler: ModuleDefaultHandler;
}

interface ResolvedFile {
  filePath: string;
  version: string;
}

interface ModuleHandlerRuntime {
  handleRequest: (
    moduleName: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => Promise<ModuleHandleResult>;
  invalidateModule: (moduleName: string) => void;
}

function parsePathSegments(requestUrl: string): string[] | undefined {
  let pathname: string;

  try {
    pathname = new URL(requestUrl, 'http://fluxion.local').pathname;
  } catch {
    return undefined;
  }

  const rawSegments = pathname.split('/').filter(Boolean);
  const segments: string[] = [];

  for (const rawSegment of rawSegments) {
    let segment: string;

    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return undefined;
    }

    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\')
    ) {
      return undefined;
    }

    segments.push(segment);
  }

  return segments;
}

function getCandidatePaths(moduleServerDirectory: string, routeSegments: readonly string[]): string[] {
  if (routeSegments.length === 0) {
    return [path.join(moduleServerDirectory, 'index.js')];
  }

  const routePath = path.join(moduleServerDirectory, ...routeSegments);
  return [path.join(routePath, 'index.js'), `${routePath}.js`];
}

function isUnderDirectory(targetPath: string, rootDirectory: string): boolean {
  const relativePath = path.relative(rootDirectory, targetPath);

  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

async function getVersionFromStat(filePath: string): Promise<string | undefined> {
  try {
    const stat = await fs.promises.stat(filePath);

    if (!stat.isFile()) {
      return undefined;
    }

    return `${stat.mtimeMs}:${stat.size}`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return undefined;
    }

    throw error;
  }
}

async function resolveHandlerFile(
  moduleServerDirectory: string,
  routeSegments: readonly string[],
): Promise<ResolvedFile | undefined> {
  const candidates = getCandidatePaths(moduleServerDirectory, routeSegments);

  for (const filePath of candidates) {
    if (!isUnderDirectory(filePath, moduleServerDirectory)) {
      continue;
    }

    const version = await getVersionFromStat(filePath);

    if (version !== undefined) {
      return { filePath, version };
    }
  }

  return undefined;
}

export function createModuleHandlerRuntime(dynamicDirectory: string): ModuleHandlerRuntime {
  const handlerCache = new Map<string, HandlerCacheEntry>();

  const loadHandler = async (filePath: string, version: string): Promise<ModuleDefaultHandler> => {
    const cached = handlerCache.get(filePath);
    if (cached !== undefined && cached.version === version) {
      return cached.handler;
    }

    const fileUrl = pathToFileURL(filePath).href;
    const loaded = await import(`${fileUrl}?v=${encodeURIComponent(version)}`);
    const defaultExport = loaded.default;

    if (typeof defaultExport !== 'function') {
      throw new TypeError(`Default export is not a function: ${filePath}`);
    }

    const handler = defaultExport as ModuleDefaultHandler;
    handlerCache.set(filePath, { version, handler });
    return handler;
  };

  const handleRequest = async (
    moduleName: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<ModuleHandleResult> => {
    if (req.url === undefined) {
      return 'not_found';
    }

    const segments = parsePathSegments(req.url);
    if (segments === undefined || segments.length === 0 || segments[0] !== moduleName) {
      return 'not_found';
    }

    const routeSegments = segments.slice(1);
    const moduleServerDirectory = path.resolve(dynamicDirectory, moduleName, 'server');
    const resolved = await resolveHandlerFile(moduleServerDirectory, routeSegments);

    if (resolved === undefined) {
      return 'not_found';
    }

    const handler = await loadHandler(resolved.filePath, resolved.version);
    await Promise.resolve(handler(req, res));
    return 'handled';
  };

  const invalidateModule = (moduleName: string): void => {
    const moduleServerDirectory = path.resolve(dynamicDirectory, moduleName, 'server');

    for (const filePath of handlerCache.keys()) {
      if (isUnderDirectory(filePath, moduleServerDirectory)) {
        handlerCache.delete(filePath);
      }
    }
  };

  return {
    handleRequest,
    invalidateModule,
  };
}
