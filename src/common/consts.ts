export const DUMMY_BASE_URL = 'http://fluxion.local';
export const META_PREFIX = '/_fluxion';

export const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

export const enum HttpCode {
  Ok = 200,
  BadRequest = 400,
  NotFound = 404,
  InternalServerError = 500,
}

export const enum HandlerResult {
  NotFound,
  Handled,
}
