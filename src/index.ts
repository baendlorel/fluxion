import type { FluxionHandler, FluxionOptions } from './core/types.js';
import { fluxion } from './core/fluxion.js';

export { fluxion, type FluxionOptions as FluxionOptions };

export function defineFluxionHandler(handler: FluxionHandler) {
  return handler;
}

// TODO 增加发送请求库+token认证的js文件，可通用地纳入dynamic directory里面，比如fetch.js/uname.js
// TODO 加入后端专用的认证机制，可以叫defineFluxionAuthedHandler，自动校验认证信息，方便处理；
// TODO 增加服务器对证书、https的支持
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

  fluxion({
    dir: process.env.DYNAMIC_DIRECTORY ?? 'dynamicDirectory',
    host: process.env.HOST ?? 'localhost',
    port: int(process.env.PORT, 9000),
    metaPort: int(process.env.META_PORT, 9001),
    reloadDelay: process.env.RELOAD_DELAY ? Number.parseInt(process.env.RELOAD_DELAY, 10) : undefined,
    workerOptions: {
      maxWorkerCount: 1,
    },
  });
}
