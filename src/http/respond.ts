import type { ServerResponse } from 'node:http';
import { HttpCode } from '@/common/consts.js';

export function sendJson(res: ServerResponse, payload: unknown, statusCode: HttpCode = HttpCode.Ok): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function safeSendJson(res: ServerResponse, payload: unknown, statusCode: HttpCode = HttpCode.Ok): void {
  if (res.writableEnded) {
    return;
  }

  if (res.headersSent) {
    res.end();
    return;
  }

  sendJson(res, payload, statusCode);
}
