import fs from 'node:fs';

import { logJsonLine } from '../common/logger.js';

export function ensureDynamicDirectory(dynamicDirectory: string): void {
  if (fs.existsSync(dynamicDirectory)) {
    return;
  }

  fs.mkdirSync(dynamicDirectory, { recursive: true });
  logJsonLine('INFO', 'dynamic_directory_created', {
    directory: dynamicDirectory,
  });
}
