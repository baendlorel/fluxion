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

export function listModuleNames(dynamicDirectory: string): string[] {
  const entries = fs.readdirSync(dynamicDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}
