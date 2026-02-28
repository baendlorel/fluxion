import type { ServerResponse } from 'node:http';
import { HttpCode } from '@/common/consts.js';

export function sendJson(res: ServerResponse, statusCode: HttpCode, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function safeSendJson(res: ServerResponse, statusCode: HttpCode, payload: unknown): void {
  if (res.writableEnded) {
    return;
  }

  if (res.headersSent) {
    res.end();
    return;
  }

  sendJson(res, statusCode, payload);
}
