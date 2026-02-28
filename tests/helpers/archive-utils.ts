import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as tar from 'tar';

export async function createTarBuffer(
  files: Record<string, string>,
  options: { gzip?: boolean } = {},
): Promise<Buffer> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxion-tar-fixture-'));

  try {
    const archiveName = options.gzip === true ? 'fixture.tar.gz' : 'fixture.tar';
    const archivePath = path.join(tempRoot, archiveName);
    const paths: string[] = [];

    for (const [entryPath, content] of Object.entries(files)) {
      const filePath = path.join(tempRoot, entryPath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
      paths.push(entryPath);
    }

    await tar.c(
      {
        cwd: tempRoot,
        file: archivePath,
        gzip: options.gzip === true,
      },
      paths,
    );

    return fs.readFile(archivePath);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
