import { fluxion } from './fluxion.js';
import { HttpCode } from './common/consts.js';

export { fluxion, HttpCode };

// Export the CLI instance config helper
export { defineFluxionInstance } from './cli/defines/fluxion-instance.js';

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

// TODO 增加依赖更新后对应url更新的机制
