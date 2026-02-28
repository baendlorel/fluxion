import type { ParsedRequestTarget } from '@/types/server.js';
import { DUMMY_BASE_URL } from '@/common/consts.js';

export function parseQuery(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];

    if (existing === undefined) {
      query[key] = value;
      continue;
    }

    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }

    query[key] = [existing, value];
  }

  return query;
}

export function parseRequestTarget(rawUrl: string | undefined): ParsedRequestTarget {
  if (rawUrl === undefined) {
    return {
      path: '(unknown)',
      query: {},
    };
  }

  try {
    const parsedUrl = new URL(rawUrl, DUMMY_BASE_URL);
    const pathname = parsedUrl.pathname;

    return {
      path: pathname,
      query: parseQuery(parsedUrl.searchParams),
    };
  } catch {
    return {
      path: rawUrl,
      query: {},
    };
  }
}
