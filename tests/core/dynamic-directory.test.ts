import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempDirectory, ensureDir, removeDirectory } from '../helpers/test-utils.js';

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

    ensureDir(dynamicDirectory);

    const stat = await fs.stat(dynamicDirectory);
    expect(stat.isDirectory()).toBe(true);
  });

  it('does nothing when dynamic directory already exists', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-dynamic-existing-');
    tempDirectories.push(dynamicDirectory);

    ensureDir(dynamicDirectory);

    const stat = await fs.stat(dynamicDirectory);
    expect(stat.isDirectory()).toBe(true);
  });
});
