export const DUMMY_BASE_URL = 'http://fluxion.local';
export const META_PREFIX = '/_fluxion';

export const STATIC_HANDLED_FLAG = Symbol.for('fluxion.router.StaticHandled');
export const HANDLER_TIMEOUT_FLAG = Symbol.for('fluxion.handlerTimeout');
export const MIDDLEWARE_TIMEOUT_FLAG = Symbol.for('fluxion.middlewareTimeout');

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
  // 2xx Success
  Ok = 200,
  Created = 201,
  Accepted = 202,
  NoContent = 204,
  PartialContent = 206,

  // 3xx Redirection
  MovedPermanently = 301,
  Found = 302,
  NotModified = 304,
  TemporaryRedirect = 307,
  PermanentRedirect = 308,

  // 4xx Client Error
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  NotFound = 404,
  MethodNotAllowed = 405,
  NotAcceptable = 406,
  RequestTimeout = 408,
  Conflict = 409,
  Gone = 410,
  PayloadTooLarge = 413,
  UnsupportedMediaType = 415,
  UnprocessableEntity = 422,
  TooManyRequests = 429,

  // 5xx Server Error
  InternalServerError = 500,
  NotImplemented = 501,
  BadGateway = 502,
  ServiceUnavailable = 503,
  GatewayTimeout = 504,
}

export const enum HandlerResult {
  NotFound,
  Handled,
}

export const enum FluxionModuleType {
  Api,
  StaticResource,
}

export const noop = () => {};
