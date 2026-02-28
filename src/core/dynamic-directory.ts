import fs from 'node:fs';

import { logJsonl } from '../common/logger.js';

export function ensureDynamicDirectory(dynamicDirectory: string): void {
  if (fs.existsSync(dynamicDirectory)) {
    return;
  }

  fs.mkdirSync(dynamicDirectory, { recursive: true });
  logJsonl('INFO', 'dynamic_directory_created', {
    directory: dynamicDirectory,
  });
}
