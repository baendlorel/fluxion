import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as tar from 'tar';

type ArchiveType = 'tar' | 'targz';
type ArchiveLayout = 'flat' | 'nested';

interface ResolveLayoutResult {
  layout: ArchiveLayout;
  moduleName: string;
  sourceDirectory: string;
}

export interface InstallArchiveResult {
  moduleName: string;
  installedPath: string;
  layout: ArchiveLayout;
}

export class ArchiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveValidationError';
  }
}

function normalizeArchiveFilename(filename: string): string {
  const trimmed = filename.trim();

  if (trimmed.length === 0) {
    throw new ArchiveValidationError('Archive filename is required');
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new ArchiveValidationError('Archive filename must not contain path separators');
  }

  return trimmed;
}

function detectArchiveType(filename: string): ArchiveType {
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz')) {
    return 'targz';
  }

  if (lowerName.endsWith('.tar')) {
    return 'tar';
  }

  throw new ArchiveValidationError('Unsupported archive format. Use .tar, .tar.gz, or .tgz');
}

function stripArchiveExtension(filename: string): string {
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith('.tar.gz')) {
    return filename.slice(0, -7);
  }

  if (lowerName.endsWith('.tgz')) {
    return filename.slice(0, -4);
  }

  if (lowerName.endsWith('.tar')) {
    return filename.slice(0, -4);
  }

  return filename;
}

function normalizeModuleName(name: string): string {
  const trimmed = name.trim();

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
    throw new ArchiveValidationError(
      `Invalid module name "${name}". Only letters, numbers, dot, underscore, and dash are allowed`,
    );
  }

  return trimmed;
}

async function pathIsDirectory(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function hasServerAndWeb(targetDirectory: string): Promise<boolean> {
  const [hasServer, hasWeb] = await Promise.all([
    pathIsDirectory(path.join(targetDirectory, 'server')),
    pathIsDirectory(path.join(targetDirectory, 'web')),
  ]);

  return hasServer && hasWeb;
}

function filterTopLevelEntries(entries: string[]): string[] {
  return entries.filter((entry) => entry !== '__MACOSX' && entry !== '.DS_Store');
}

async function resolveArchiveLayout(
  extractDirectory: string,
  archiveFilename: string,
): Promise<ResolveLayoutResult> {
  const topLevelEntries = filterTopLevelEntries(await fs.readdir(extractDirectory));

  if (await hasServerAndWeb(extractDirectory)) {
    return {
      layout: 'flat',
      moduleName: normalizeModuleName(stripArchiveExtension(archiveFilename)),
      sourceDirectory: extractDirectory,
    };
  }

  if (topLevelEntries.length === 1) {
    const [onlyEntry] = topLevelEntries;
    const nestedDirectory = path.join(extractDirectory, onlyEntry);

    if (await pathIsDirectory(nestedDirectory)) {
      if (await hasServerAndWeb(nestedDirectory)) {
        return {
          layout: 'nested',
          moduleName: normalizeModuleName(onlyEntry),
          sourceDirectory: nestedDirectory,
        };
      }
    }
  }

  throw new ArchiveValidationError(
    'Invalid archive structure. Expected either top-level server/ and web/, or a single top-level folder containing server/ and web/',
  );
}

async function extractArchive(archivePath: string, extractDirectory: string, archiveType: ArchiveType): Promise<void> {
  await tar.x({
    file: archivePath,
    cwd: extractDirectory,
    gzip: archiveType === 'targz',
    strict: true,
  });
}

async function installLayout(
  layout: ArchiveLayout,
  sourceDirectory: string,
  targetDirectory: string,
): Promise<void> {
  await fs.rm(targetDirectory, { recursive: true, force: true });

  if (layout === 'flat') {
    await fs.mkdir(targetDirectory, { recursive: true });

    await fs.cp(path.join(sourceDirectory, 'server'), path.join(targetDirectory, 'server'), {
      recursive: true,
    });
    await fs.cp(path.join(sourceDirectory, 'web'), path.join(targetDirectory, 'web'), {
      recursive: true,
    });

    return;
  }

  await fs.cp(sourceDirectory, targetDirectory, { recursive: true });
}

interface InstallModuleArchiveOptions {
  archiveBuffer: Buffer;
  archiveFilename: string;
  dynamicDirectory: string;
}

export async function installModuleArchive(options: InstallModuleArchiveOptions): Promise<InstallArchiveResult> {
  const archiveFilename = normalizeArchiveFilename(options.archiveFilename);
  const archiveType = detectArchiveType(archiveFilename);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxion-upload-'));

  try {
    const archivePath = path.join(tempRoot, archiveFilename);
    const extractDirectory = path.join(tempRoot, 'extract');

    await fs.writeFile(archivePath, options.archiveBuffer);
    await fs.mkdir(extractDirectory, { recursive: true });

    await extractArchive(archivePath, extractDirectory, archiveType);

    const layoutResult = await resolveArchiveLayout(extractDirectory, archiveFilename);
    const installedPath = path.resolve(options.dynamicDirectory, layoutResult.moduleName);

    await fs.mkdir(path.resolve(options.dynamicDirectory), { recursive: true });
    await installLayout(layoutResult.layout, layoutResult.sourceDirectory, installedPath);

    return {
      moduleName: layoutResult.moduleName,
      installedPath,
      layout: layoutResult.layout,
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
