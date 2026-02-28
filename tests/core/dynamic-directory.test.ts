import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureDynamicDirectory, listModuleNames } from '@/core/dynamic-directory.js';

import { createTempDirectory, removeDirectory, writeFile } from '../helpers/test-utils.js';

describe('dynamic-directory', () => {
  const tempDirectories: string[] = [];

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const tempDirectory of tempDirectories.splice(0)) {
      await removeDirectory(tempDirectory);
    }

    vi.restoreAllMocks();
  });

  it('creates missing dynamic directory', async () => {
    const root = await createTempDirectory('fluxion-dynamic-directory-');
    tempDirectories.push(root);

    const dynamicDirectory = path.join(root, 'dynamic');
    const existsBefore = await fs
      .stat(dynamicDirectory)
      .then(() => true)
      .catch(() => false);

    expect(existsBefore).toBe(false);

    ensureDynamicDirectory(dynamicDirectory);

    const stat = await fs.stat(dynamicDirectory);
    expect(stat.isDirectory()).toBe(true);
  });

  it('lists only first-level module directories in sorted order', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-module-list-');
    tempDirectories.push(dynamicDirectory);

    await fs.mkdir(path.join(dynamicDirectory, 'zeta'), { recursive: true });
    await fs.mkdir(path.join(dynamicDirectory, 'alpha', 'nested'), { recursive: true });
    await writeFile(path.join(dynamicDirectory, 'README.md'), 'file should be ignored');

    expect(listModuleNames(dynamicDirectory)).toEqual(['alpha', 'zeta']);
  });
});
