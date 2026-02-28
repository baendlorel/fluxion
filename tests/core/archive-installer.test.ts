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

  it('installs flat server/web tar archive using archive name as module name', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-archive-flat-');
    tempDirectories.push(dynamicDirectory);

    const archiveBuffer = await createTarBuffer({
      'server/index.js': "export default function handler(_req, res) { res.end('ok'); }",
      'web/index.html': '<h1>hello</h1>',
    });

    const result = await installModuleArchive({
      archiveBuffer,
      archiveFilename: 'demo-module.tar',
      dynamicDirectory,
    });

    expect(result.moduleName).toBe('demo-module');
    expect(result.layout).toBe('flat');

    const serverStat = await fs.stat(path.join(dynamicDirectory, 'demo-module', 'server'));
    const webStat = await fs.stat(path.join(dynamicDirectory, 'demo-module', 'web'));

    expect(serverStat.isDirectory()).toBe(true);
    expect(webStat.isDirectory()).toBe(true);
  });

  it('installs nested folder archive using inner folder name as module name', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-archive-nested-');
    tempDirectories.push(dynamicDirectory);

    const archiveBuffer = await createTarBuffer({
      'cool-app/server/index.js': "export default function handler(_req, res) { res.end('ok'); }",
      'cool-app/web/index.html': '<h1>cool</h1>',
      'cool-app/README.md': 'extra files should be kept in nested mode',
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

  it('rejects invalid archive structure', async () => {
    const dynamicDirectory = await createTempDirectory('fluxion-archive-invalid-');
    tempDirectories.push(dynamicDirectory);

    const archiveBuffer = await createTarBuffer({
      'foo.txt': 'missing server and web folders',
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
        'gzip-app/server/index.js': "export default function handler(_req, res) { res.end('ok'); }",
        'gzip-app/web/index.html': '<h1>gzip</h1>',
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
      'server/index.js': "export default function handler(_req, res) { res.end('ok'); }",
      'web/index.html': '<h1>hello</h1>',
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
