import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ArchiveValidationError, installModuleArchive } from '@/core/archive-installer.js';

import { createTarBuffer } from '../helpers/archive-utils.js';
import { createTempDirectory, removeDirectory } from '../helpers/test-utils.js';

describe('archive-installer', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    for (const tempDirectory of tempDirectories.splice(0)) {
      await removeDirectory(tempDirectory);
    }
  });

  it('installs flat archive using archive name as module name', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-archive-flat-');
    tempDirectories.push(dynamicDirectory);

    const archiveBuffer = await createTarBuffer({
      'hello.mjs': "export default function handler(_req, res) { res.end('ok'); }",
      'public/app.js': "console.log('hello');",
    });

    const result = await installModuleArchive({
      archiveBuffer,
      archiveFilename: 'demo-module.tar',
      dynamicDirectory,
    });

    expect(result.moduleName).toBe('demo-module');
    expect(result.layout).toBe('flat');

    const handler = await fs.readFile(path.join(dynamicDirectory, 'demo-module', 'hello.mjs'), 'utf8');
    const staticFile = await fs.readFile(path.join(dynamicDirectory, 'demo-module', 'public', 'app.js'), 'utf8');

    expect(handler).toContain('export default function handler');
    expect(staticFile).toContain("console.log('hello')");
  });

  it('installs nested folder archive using inner folder name as module name', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-archive-nested-');
    tempDirectories.push(dynamicDirectory);

    const archiveBuffer = await createTarBuffer({
      'cool-app/index.mjs': "export default function handler(_req, res) { res.end('ok'); }",
      'cool-app/assets/app.js': "console.log('cool');",
      'cool-app/README.md': 'extra files should be kept',
    });

    const result = await installModuleArchive({
      archiveBuffer,
      archiveFilename: 'anything.tar',
      dynamicDirectory,
    });

    expect(result.moduleName).toBe('cool-app');
    expect(result.layout).toBe('nested');

    const readme = await fs.readFile(path.join(dynamicDirectory, 'cool-app', 'README.md'), 'utf8');
    expect(readme).toContain('extra files');
  });

  it('supports underscore-prefixed module name', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-archive-underscore-');
    tempDirectories.push(dynamicDirectory);

    const archiveBuffer = await createTarBuffer({
      '_lib/util.mjs': 'export default function handler() {}',
    });

    const result = await installModuleArchive({
      archiveBuffer,
      archiveFilename: 'ignored.tar',
      dynamicDirectory,
    });

    expect(result.moduleName).toBe('_lib');
    const stat = await fs.stat(path.join(dynamicDirectory, '_lib'));
    expect(stat.isDirectory()).toBe(true);
  });

  it('rejects archive with no usable top-level entries', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-archive-empty-');
    tempDirectories.push(dynamicDirectory);

    const archiveBuffer = await createTarBuffer({
      '__MACOSX/.DS_Store': 'ignored',
    });

    await expect(
      installModuleArchive({
        archiveBuffer,
        archiveFilename: 'broken.tar',
        dynamicDirectory,
      }),
    ).rejects.toBeInstanceOf(ArchiveValidationError);
  });

  it('supports .tar.gz archive', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-archive-gzip-');
    tempDirectories.push(dynamicDirectory);

    const archiveBuffer = await createTarBuffer(
      {
        'gzip-app/index.mjs': "export default function handler(_req, res) { res.end('ok'); }",
      },
      { gzip: true },
    );

    const result = await installModuleArchive({
      archiveBuffer,
      archiveFilename: 'gzip-app.tar.gz',
      dynamicDirectory,
    });

    expect(result.moduleName).toBe('gzip-app');
    expect(result.layout).toBe('nested');
  });

  it('rejects zip archive extension', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-archive-no-zip-');
    tempDirectories.push(dynamicDirectory);

    const archiveBuffer = await createTarBuffer({
      'hello.mjs': "export default function handler(_req, res) { res.end('ok'); }",
    });

    await expect(
      installModuleArchive({
        archiveBuffer,
        archiveFilename: 'demo.zip',
        dynamicDirectory,
      }),
    ).rejects.toThrow('Unsupported archive format');
  });
});
