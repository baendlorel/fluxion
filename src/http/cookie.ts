/**
 * Parse Cookie header string into an object
 */
export function parseCookie(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');
  let count = 0;
  const MAX_COOKIE_KEYS = 100;

  for (const pair of pairs) {
    if (count >= MAX_COOKIE_KEYS) {
      break;
    }
    const [key, ...valueParts] = pair.split('=');
    if (!key) continue;

    const trimmedKey = key.trim();
    const value = valueParts.join('=').trim();
    cookies[trimmedKey] = decodeURIComponent(value);
    count++;
  }

  return cookies;
}

/**
 * Serialize an object into a Cookie header string
 */
export function serializeCookie(
  name: string,
  value: string,
  options?: {
    maxAge?: number;
    expires?: Date;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
  },
): string {
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (options) {
    if (options.maxAge !== undefined) {
      cookie += `; Max-Age=${options.maxAge}`;
    }
    if (options.expires) {
      cookie += `; Expires=${options.expires.toUTCString()}`;
    }
    if (options.domain) {
      cookie += `; Domain=${options.domain}`;
    }
    if (options.path) {
      cookie += `; Path=${options.path}`;
    }
    if (options.secure) {
      cookie += '; Secure';
    }
    if (options.httpOnly) {
      cookie += '; HttpOnly';
    }
    if (options.sameSite) {
      cookie += `; SameSite=${options.sameSite}`;
    }
  }

  return cookie;
}
