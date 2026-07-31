#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { platform, arch } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const PLATFORM_MAP: Record<string, string> = {
  linux: 'linux',
  darwin: 'darwin',
  win32: 'win',
};

const ARCH_MAP: Record<string, string> = {
  x64: 'x64',
  arm64: 'arm64',
  ia32: 'x86_64', // fallback
};

function getBinaryPath() {
  const currentPlatform = PLATFORM_MAP[platform()] ?? 'linux';
  const currentArch = ARCH_MAP[arch()] ?? 'x64';

  const binaryName = `fluxion-${currentPlatform}-${currentArch}${platform() === 'win32' ? '.exe' : ''}`;
  const binaryPath = join(__dirname, 'bin', binaryName);

  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  const localBinary = join(
    __dirname,
    '..',
    '..',
    'cli',
    'target',
    'release',
    platform() === 'win32' ? 'fluxion-cli.exe' : 'fluxion-cli',
  );

  if (existsSync(localBinary)) {
    return localBinary;
  }

  throw new Error(`No binary found for ${currentPlatform}-${currentArch}. Please run 'npm run build:cli' first.`);
}

function main() {
  try {
    const binaryPath = getBinaryPath();
    const args = process.argv.slice(2);

    const child = spawn(binaryPath, args, {
      stdio: 'inherit',
      env: { ...process.env },
      detached: true,
    });

    child.on('error', (error) => {
      console.error(`Failed to start fluxion-cli: ${error.message}`);
      process.exit(1);
    });

    child.on('exit', (code) => {
      process.exit(code || 0);
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
