import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';

import { STATIC_CONTENT_TYPES } from '@/common/consts.js';

/**
 * Returns static content-type by file extension.
 */
function getContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return STATIC_CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * Generates file version token from mtime and size.
 */
export async function getFileVersion(filePath: string): Promise<string | undefined> {
  try {
    const stat = await fs.promises.stat(filePath);

    if (!stat.isFile()) {
      return undefined;
    }

    return `${stat.mtimeMs}:${stat.size}`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return undefined;
    }

    throw error;
  }
}

/**
 * Streams static file to response.
 */
export async function streamStaticFile(
  filePath: string,
  stat: fs.Stats,
  method: string | undefined,
  res: http.ServerResponse,
): Promise<void> {
  res.statusCode = 200;
  res.setHeader('Content-Type', getContentType(filePath));
  res.setHeader('Content-Length', String(stat.size));

  if (method === 'HEAD') {
    res.end();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}
