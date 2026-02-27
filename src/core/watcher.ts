import fs from 'node:fs';

import { logJsonLine } from '../common/logger.js';

interface DirectoryWatcher {
  close: () => void;
}

function createDynamicDirectoryWatcher(dynamicDirectory: string, onChange: () => void): fs.FSWatcher {
  try {
    return fs.watch(dynamicDirectory, { recursive: true }, onChange);
  } catch {
    logJsonLine('WARN', 'recursive_watch_unavailable', { dynamicDirectory });
    return fs.watch(dynamicDirectory, onChange);
  }
}

export function watchDirectoryDiff(dynamicDirectory: string, onChange: () => void, debounceMs = 80): DirectoryWatcher {
  let syncTimer: NodeJS.Timeout | undefined;

  const watcher = createDynamicDirectoryWatcher(dynamicDirectory, () => {
    if (syncTimer !== undefined) {
      clearTimeout(syncTimer);
    }

    syncTimer = setTimeout(() => {
      syncTimer = undefined;
      onChange();
    }, debounceMs);
  });

  return {
    close() {
      watcher.close();

      if (syncTimer !== undefined) {
        clearTimeout(syncTimer);
        syncTimer = undefined;
      }
    },
  };
}
