import { fluxion } from './fluxion.js';
import { HttpCode } from './common/consts.js';

export { fluxion, HttpCode };

/**
 * Export fluxion version for users' debugging.
 * @version __VERSION__
 */
export const VERSION = '__VERSION__';

// Export all HTTP exceptions
export {
  HttpException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  MethodNotAllowedException,
  NotAcceptableException,
  RequestTimeoutException,
  ConflictException,
  GoneException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
  TooManyRequestsException,
  InternalServerErrorException,
  NotImplementedException,
  BadGatewayException,
  ServiceUnavailableException,
  GatewayTimeoutException,
} from './http/exceptions.js';

export * from './defines/index.js';

export type {
  FluxionRequest,
  FluxionModuleContext,
  FluxionDisposer,
  FluxionHandler,
  FluxionModule,
  FluxionOptions,
} from './types.js';
