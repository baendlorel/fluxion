import { DUMMY_BASE_URL } from '@/common/consts.js';

export function toURL(rawUrl: string | undefined): URL | undefined {
  if (rawUrl === undefined) {
    return undefined;
  }

  try {
    return new URL(rawUrl, DUMMY_BASE_URL);
  } catch {
    return undefined;
  }
}
