import { HttpCode } from '@/common/consts.js';

/**
 * Base class for all HTTP exceptions
 */
export abstract class HttpException extends Error implements NodeJS.ErrnoException {
  errno?: number | undefined;
  code?: string | undefined;

  constructor(message: string, statusCode: HttpCode, code: string) {
    super(message);
    this.name = 'HttpException';
    this.errno = statusCode;
    this.code = code;
  }
}

// 4xx Client Error Exceptions

/**
 * 400 Bad Request - Malformed or invalid request
 */
export class BadRequestException extends HttpException {
  constructor(message: string = 'Bad Request') {
    super(message, HttpCode.BadRequest, 'BAD_REQUEST');
  }
}

/**
 * 401 Unauthorized - Authentication required or failed
 */
export class UnauthorizedException extends HttpException {
  constructor(message: string = 'Unauthorized') {
    super(message, HttpCode.Unauthorized, 'UNAUTHORIZED');
  }
}

/**
 * 403 Forbidden - Valid request but refused authorization
 */
export class ForbiddenException extends HttpException {
  constructor(message: string = 'Forbidden') {
    super(message, HttpCode.Forbidden, 'FORBIDDEN');
  }
}

/**
 * 404 Not Found - Resource does not exist
 */
export class NotFoundException extends HttpException {
  constructor(message: string = 'Not Found') {
    super(message, HttpCode.NotFound, 'NOT_FOUND');
  }
}

/**
 * 405 Method Not Allowed - HTTP method not supported for resource
 */
export class MethodNotAllowedException extends HttpException {
  constructor(message: string = 'Method Not Allowed') {
    super(message, HttpCode.MethodNotAllowed, 'METHOD_NOT_ALLOWED');
  }
}

/**
 * 406 Not Acceptable - Cannot generate acceptable response
 */
export class NotAcceptableException extends HttpException {
  constructor(message: string = 'Not Acceptable') {
    super(message, HttpCode.NotAcceptable, 'NOT_ACCEPTABLE');
  }
}

/**
 * 408 Request Timeout - Client did not produce request within time
 */
export class RequestTimeoutException extends HttpException {
  constructor(message: string = 'Request Timeout') {
    super(message, HttpCode.RequestTimeout, 'REQUEST_TIMEOUT');
  }
}

/**
 * 409 Conflict - Request conflicts with current state
 */
export class ConflictException extends HttpException {
  constructor(message: string = 'Conflict') {
    super(message, HttpCode.Conflict, 'CONFLICT');
  }
}

/**
 * 410 Gone - Resource no longer available
 */
export class GoneException extends HttpException {
  constructor(message: string = 'Gone') {
    super(message, HttpCode.Gone, 'GONE');
  }
}

/**
 * 413 Payload Too Large - Request entity larger than limits
 */
export class PayloadTooLargeException extends HttpException {
  constructor(message: string = 'Payload Too Large') {
    super(message, HttpCode.PayloadTooLarge, 'PAYLOAD_TOO_LARGE');
  }
}

/**
 * 415 Unsupported Media Type - Requested format not supported
 */
export class UnsupportedMediaTypeException extends HttpException {
  constructor(message: string = 'Unsupported Media Type') {
    super(message, HttpCode.UnsupportedMediaType, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

/**
 * 422 Unprocessable Entity - Syntactically correct but semantically erroneous
 */
export class UnprocessableEntityException extends HttpException {
  constructor(message: string = 'Unprocessable Entity') {
    super(message, HttpCode.UnprocessableEntity, 'UNPROCESSABLE_ENTITY');
  }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export class TooManyRequestsException extends HttpException {
  constructor(message: string = 'Too Many Requests') {
    super(message, HttpCode.TooManyRequests, 'TOO_MANY_REQUESTS');
  }
}

// 5xx Server Error Exceptions

/**
 * 500 Internal Server Error - Unexpected server condition
 */
export class InternalServerErrorException extends HttpException {
  constructor(message: string = 'Internal Server Error') {
    super(message, HttpCode.InternalServerError, 'INTERNAL_SERVER_ERROR');
  }
}

/**
 * 501 Not Implemented - Server does not support functionality
 */
export class NotImplementedException extends HttpException {
  constructor(message: string = 'Not Implemented') {
    super(message, HttpCode.NotImplemented, 'NOT_IMPLEMENTED');
  }
}

/**
 * 502 Bad Gateway - Invalid response from upstream server
 */
export class BadGatewayException extends HttpException {
  constructor(message: string = 'Bad Gateway') {
    super(message, HttpCode.BadGateway, 'BAD_GATEWAY');
  }
}

/**
 * 503 Service Unavailable - Server temporarily unavailable
 */
export class ServiceUnavailableException extends HttpException {
  constructor(message: string = 'Service Unavailable') {
    super(message, HttpCode.ServiceUnavailable, 'SERVICE_UNAVAILABLE');
  }
}

/**
 * 504 Gateway Timeout - Upstream server timeout
 */
export class GatewayTimeoutException extends HttpException {
  constructor(message: string = 'Gateway Timeout') {
    super(message, HttpCode.GatewayTimeout, 'GATEWAY_TIMEOUT');
  }
}
