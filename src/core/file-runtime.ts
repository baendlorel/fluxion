import { STATIC_CONTENT_TYPES, DUMMY_BASE_URL } from '@/common/consts.js';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type FileRuntimeHandleResult = 'handled' | 'not_found';

type ModuleDefaultHandler = (req: http.IncomingMessage, res: http.ServerResponse) => unknown;

interface HandlerCacheEntry {
  handler: ModuleDefaultHandler;
  version: string;
}

interface ParsedPath {
  pathname: string;
  segments: string[];
}

interface ResolvedHandlerFile {
  filePath: string;
  version: string;
}

interface RouteEntryBase {
  file: string;
  version: string;
}

export interface HandlerRouteEntry extends RouteEntryBase {
  route: string;
}

export interface StaticRouteEntry extends RouteEntryBase {
  route: string;
}

export interface FileRouteSnapshot {
  handlers: HandlerRouteEntry[];
  staticFiles: StaticRouteEntry[];
}

export interface FileRuntime {
  clearCache: () => void;
  getRouteSnapshot: () => Promise<FileRouteSnapshot>;
  handleRequest: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<FileRuntimeHandleResult>;
}

function getContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return STATIC_CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function isUnderDirectory(targetPath: string, rootDirectory: string): boolean {
  const relativePath = path.relative(rootDirectory, targetPath);
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isIgnoredSegment(segment: string): boolean {
  return segment.startsWith('_');
}

function parseRequestPath(rawUrl: string): ParsedPath | undefined {
  let pathname: string;

  try {
    pathname = new URL(rawUrl, DUMMY_BASE_URL).pathname;
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
      segment.includes('\\') ||
      isIgnoredSegment(segment)
    ) {
      return undefined;
    }

    segments.push(segment);
  }

  return { pathname, segments };
}

async function getFileVersion(filePath: string): Promise<string | undefined> {
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

function toPublicRoute(relativePath: string): string {
  if (relativePath.length === 0) {
    return '/';
  }

  return `/${normalizeRelativePath(relativePath)}`;
}

function getRouteFromHandlerFile(relativePath: string): string {
  const normalizedRelativePath = normalizeRelativePath(relativePath);

  if (normalizedRelativePath === 'index.mjs') {
    return '/';
  }

  if (normalizedRelativePath.endsWith('/index.mjs')) {
    const routePath = normalizedRelativePath.slice(0, -'/index.mjs'.length);
    return toPublicRoute(routePath);
  }

  if (normalizedRelativePath.endsWith('.mjs')) {
    const routePath = normalizedRelativePath.slice(0, -'.mjs'.length);
    return toPublicRoute(routePath);
  }

  return toPublicRoute(normalizedRelativePath);
}

function buildHandlerCandidates(dynamicDirectory: string, segments: readonly string[]): string[] {
  if (segments.length === 0) {
    return [path.resolve(dynamicDirectory, 'index.mjs')];
  }

  const routePath = path.resolve(dynamicDirectory, ...segments);

  return [path.resolve(routePath, 'index.mjs'), `${routePath}.mjs`];
}

async function streamStaticFile(
  filePath: string,
  stat: fs.Stats,
  method: string | undefined,
  res: http.ServerResponse,
): Promise<void> {
  res.statusCode = 200;
  res.setHeader('Content-Type', getContentType(filePath));
  res.setHeader('Content-Length', String(stat.size));

  if (method === 'HEAD') {
    res.end();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

export function createFileRuntime(dynamicDirectory: string): FileRuntime {
  const handlerCache = new Map<string, HandlerCacheEntry>();

  const loadHandler = async (filePath: string, version: string): Promise<ModuleDefaultHandler> => {
    const cached = handlerCache.get(filePath);

    if (cached !== undefined && cached.version === version) {
      return cached.handler;
    }

    const fileUrl = `${pathToFileURL(filePath).href}?v=${encodeURIComponent(version)}`;
    console.log('fileUrl', fileUrl);
    const loaded = await import(fileUrl);
    const defaultExport = loaded.default;

    if (typeof defaultExport !== 'function') {
      throw new TypeError(`Default export is not a function: ${filePath}`);
    }

    const handler = defaultExport as ModuleDefaultHandler;
    handlerCache.set(filePath, { handler, version });
    return handler;
  };

  const resolveHandlerFile = async (segments: readonly string[]): Promise<ResolvedHandlerFile | undefined> => {
    const candidates = buildHandlerCandidates(dynamicDirectory, segments);

    for (const filePath of candidates) {
      if (!isUnderDirectory(filePath, dynamicDirectory)) {
        continue;
      }

      const version = await getFileVersion(filePath);

      if (version !== undefined) {
        return { filePath, version };
      }
    }

    return undefined;
  };

  const tryHandleHandler = async (
    parsedPath: ParsedPath,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<FileRuntimeHandleResult> => {
    if (parsedPath.pathname.endsWith('.mjs')) {
      return 'not_found';
    }

    const resolved = await resolveHandlerFile(parsedPath.segments);

    if (resolved === undefined) {
      return 'not_found';
    }

    const handler = await loadHandler(resolved.filePath, resolved.version);
    await Promise.resolve(handler(req, res));
    return 'handled';
  };

  const tryHandleStatic = async (
    parsedPath: ParsedPath,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<FileRuntimeHandleResult> => {
    const method = req.method ?? 'GET';

    if (method !== 'GET' && method !== 'HEAD') {
      return 'not_found';
    }

    if (parsedPath.segments.length === 0) {
      return 'not_found';
    }

    const filePath = path.resolve(dynamicDirectory, ...parsedPath.segments);

    if (!isUnderDirectory(filePath, dynamicDirectory)) {
      return 'not_found';
    }

    if (path.extname(filePath).toLowerCase() === '.mjs') {
      return 'not_found';
    }

    try {
      const stat = await fs.promises.stat(filePath);

      if (!stat.isFile()) {
        return 'not_found';
      }

      await streamStaticFile(filePath, stat, method, res);
      return 'handled';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return 'not_found';
      }

      throw error;
    }
  };

  const getRouteSnapshot = async (): Promise<FileRouteSnapshot> => {
    const handlerByRoute = new Map<string, { entry: HandlerRouteEntry; priority: number }>();
    const staticFiles: StaticRouteEntry[] = [];

    const readEntries = async (directory: string): Promise<fs.Dirent[]> => {
      try {
        return await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;

        if (code === 'ENOENT' || code === 'ENOTDIR') {
          return [];
        }

        throw error;
      }
    };

    const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
      const entries = await readEntries(directory);

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.isDirectory()) {
          if (isIgnoredSegment(entry.name)) {
            continue;
          }

          const childDirectory = path.join(directory, entry.name);
          const childRelativeDirectory = path.join(relativeDirectory, entry.name);
          await walk(childDirectory, childRelativeDirectory);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const absolutePath = path.join(directory, entry.name);
        const relativePath = path.join(relativeDirectory, entry.name);
        const version = await getFileVersion(absolutePath);

        if (version === undefined) {
          continue;
        }

        if (entry.name.endsWith('.mjs')) {
          const route = getRouteFromHandlerFile(relativePath);
          const entryItem: HandlerRouteEntry = {
            route,
            file: normalizeRelativePath(relativePath),
            version,
          };
          const priority = entry.name === 'index.mjs' ? 0 : 1;
          const existing = handlerByRoute.get(route);

          if (existing === undefined || priority < existing.priority) {
            handlerByRoute.set(route, { entry: entryItem, priority });
          }

          continue;
        }

        staticFiles.push({
          route: toPublicRoute(relativePath),
          file: normalizeRelativePath(relativePath),
          version,
        });
      }
    };

    await walk(dynamicDirectory, '');

    const handlers = Array.from(handlerByRoute.values())
      .map((item) => item.entry)
      .sort((left, right) => left.route.localeCompare(right.route));

    staticFiles.sort((left, right) => left.route.localeCompare(right.route));

    return {
      handlers,
      staticFiles,
    };
  };

  return {
    clearCache() {
      handlerCache.clear();
    },
    getRouteSnapshot,
    async handleRequest(req, res) {
      if (req.url === undefined) {
        return 'not_found';
      }
      // todo 重新加载的时候要有log
      const parsedPath = parseRequestPath(req.url);

      if (parsedPath === undefined) {
        return 'not_found';
      }

      const handlerResult = await tryHandleHandler(parsedPath, req, res);

      if (handlerResult === 'handled') {
        return 'handled';
      }

      return tryHandleStatic(parsedPath, req, res);
    },
  };
}
