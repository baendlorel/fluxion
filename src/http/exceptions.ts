import { HttpCode } from '@/common/consts.js';

export class BadRequestException extends Error implements NodeJS.ErrnoException {
  errno?: number | undefined;
  code?: string | undefined;
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
    this.errno = HttpCode.BadRequest;
  }
}
