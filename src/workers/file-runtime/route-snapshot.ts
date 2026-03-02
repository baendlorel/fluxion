import fs from 'node:fs';
import path from 'node:path';

import { getFileVersion } from './file-system.js';
import { getRouteFromHandlerFile, isIgnoredSegment, normalizeRelativePath, toPublicRoute } from './path-utils.js';
import type { FileRouteSnapshot, HandlerRouteEntry, StaticRouteEntry } from './index.js';

/**
 * Scans dynamic directory and builds route snapshot.
 */
export async function buildRouteSnapshot(dir: string): Promise<FileRouteSnapshot> {
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

  await walk(dir, '');

  const handlers = Array.from(handlerByRoute.values())
    .map((item) => item.entry)
    .sort((left, right) => left.route.localeCompare(right.route));

  staticFiles.sort((left, right) => left.route.localeCompare(right.route));

  return {
    handlers,
    staticFiles,
  };
}
