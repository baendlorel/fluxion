import path from 'node:path';

import type { ParsedPath } from './index.js';

/**
 * Normalizes file separators to `/` for route output.
 */
export function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

/**
 * Converts relative path into public route.
 */
export function toPublicRoute(relativePath: string): string {
  if (relativePath.length === 0) {
    return '/';
  }

  return `/${normalizeRelativePath(relativePath)}`;
}

/**
 * Maps handler file path to route path.
 */
export function getRouteFromHandlerFile(relativePath: string): string {
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

/**
 * Verifies target path is still under root directory.
 * ! Prevents directory traversal when resolving dynamic files.
 */
export function isUnderDirectory(targetPath: string, rootDirectory: string): boolean {
  const relativePath = path.relative(rootDirectory, targetPath);
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

/**
 * Private segments are not routable.
 */
export function isIgnoredSegment(segment: string): boolean {
  return segment.startsWith('_');
}

/**
 * Parses and validates pathname into safe segments.
 */
export function parseRequestPath(url: URL): ParsedPath | undefined {
  const pathname = url.pathname;
  const rawSegments = pathname.split('/').filter(Boolean);
  const segments: string[] = [];

  for (let i = 0; i < rawSegments.length; i++) {
    const rawSegment = rawSegments[i];
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

/**
 * Builds ordered handler candidates for a route.
 */
export function buildHandlerCandidates(dynamicDirectory: string, segments: readonly string[]): string[] {
  if (segments.length === 0) {
    return [path.resolve(dynamicDirectory, 'index.mjs')];
  }

  const routePath = path.resolve(dynamicDirectory, ...segments);
  return [path.resolve(routePath, 'index.mjs'), `${routePath}.mjs`];
}

/**
 * Builds ordered static file candidates for one route.
 */
export function buildStaticCandidates(dynamicDirectory: string, segments: readonly string[]): string[] {
  if (segments.length === 0) {
    return [path.resolve(dynamicDirectory, 'index.html')];
  }

  const routePath = path.resolve(dynamicDirectory, ...segments);
  const candidates = [routePath];
  const lastSegment = segments[segments.length - 1];

  if (path.extname(lastSegment).length === 0) {
    candidates.push(path.resolve(routePath, 'index.html'));
  }

  return candidates;
}
