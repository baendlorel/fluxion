import { fluxion } from './fluxion.js';
import { HttpCode } from './common/consts.js';
import { defineFluxionLogger } from './defines/index.js';
import stringify from 'fast-json-stable-stringify';

export { fluxion, HttpCode };

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

export type { FluxionDispose, FluxionHandler, FluxionModule as FluxionHandlerModule, FluxionOptions } from './types.js';

if (process.env.NODE_ENV !== 'production') {
  globalThis.$throw = (message: string) => {
    throw new Error('[fluxion error]' + message);
  };

  const int = (n: string | undefined, defaultValue: number): number => {
    if (n === undefined) {
      return defaultValue;
    }
    const parsed = Number.parseInt(n, 10);
    if (Number.isNaN(parsed)) {
      return defaultValue;
    }
    return parsed;
  };

  const logger = defineFluxionLogger((entry) => {
    console.log(stringify(entry));
  });

  fluxion({
    dir: process.env.DYNAMIC_DIRECTORY ?? 'dynamicDirectory',
    host: process.env.HOST ?? 'localhost',
    port: int(process.env.PORT, 9000),
    metaPort: int(process.env.META_PORT, 9001),
    reloadDelay: process.env.RELOAD_DELAY ? Number.parseInt(process.env.RELOAD_DELAY, 10) : undefined,
    workerOptions: {
      maxWorkerCount: 4,
    },
    logger,
  });
}
