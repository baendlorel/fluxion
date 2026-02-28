import type { IncomingMessage } from 'node:http';

export function getRealIp(req: IncomingMessage): string {
  const forwardedFor = req.headersDistinct['x-forwarded-for'];
  if (forwardedFor) {
    const firstForwarded = forwardedFor[0]?.split(',')[0]?.trim();
    if (firstForwarded && firstForwarded.length > 0) {
      return firstForwarded;
    }
  }

  const realIp = req.headersDistinct['x-real-ip']?.[0].trim();
  if (realIp !== undefined) {
    return realIp;
  }

  return req.socket.remoteAddress ?? 'unknown';
}
