#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { platform, arch } from 'node:os';
import { join } from 'node:path';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import https from 'node:https';

// 平台和架构映射
const PLATFORM_MAP: Record<string, string> = {
  linux: 'linux',
  darwin: 'darwin',
  win32: 'win',
};

const ARCH_MAP: Record<string, string> = {
  x64: 'x64',
  arm64: 'arm64',
  ia32: 'x86_64',
};

const GITHUB_REPO = 'baendlorel/fluxion';
const BINARY_NAME = 'fluxion-cli';

interface BinaryInfo {
  platform: string;
  arch: string;
  binaryName: string;
  extension: string;
  platformName: string;
}

function getBinaryInfo(): BinaryInfo {
  const currentPlatform: string = PLATFORM_MAP[platform()] || 'linux';
  const currentArch: string = ARCH_MAP[arch()] || 'x64';

  const extension: string = platform() === 'win32' ? '.exe' : '';
  const binaryName: string = `${BINARY_NAME}-${currentPlatform}-${currentArch}${extension}`;

  return {
    platform: currentPlatform,
    arch: currentArch,
    binaryName,
    extension,
    platformName: `${currentPlatform}-${currentArch}`,
  };
}

function getInstallDir(): string {
  const homeDir: string = process.env.HOME || process.env.USERPROFILE || '';
  const installDir: string = join(homeDir, '.fluxion', 'bin');

  if (!existsSync(installDir)) {
    mkdirSync(installDir, { recursive: true });
  }

  return installDir;
}

function getBinaryPath(): string {
  const binaryInfo: BinaryInfo = getBinaryInfo();
  const installDir: string = getInstallDir();
  return join(installDir, binaryInfo.binaryName);
}

async function getLatestVersion(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'fluxion-installer',
        'Accept': 'application/vnd.github.v3+json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          if (release && release.tag_name) {
            resolve(release.tag_name.replace(/^v/, ''));
          } else {
            reject(new Error('No releases found'));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

async function downloadBinary(version: string, binaryInfo: BinaryInfo): Promise<void> {
  const installDir: string = getInstallDir();
  const targetPath: string = join(installDir, binaryInfo.binaryName);

  const url: string = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${binaryInfo.binaryName}`;

  console.log(`📥 Downloading ${binaryInfo.binaryName} from ${url}...`);

  return new Promise<void>((resolve, reject) => {
    const file = createWriteStream(targetPath);

    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function makeExecutable(filePath: string): Promise<void> {
  if (platform() !== 'win32') {
    try {
      await chmod(filePath, 0o755);
    } catch (error) {
      console.warn(`⚠️  Failed to make binary executable: ${error}`);
    }
  }
}

async function ensureBinary(): Promise<string> {
  const binaryInfo: BinaryInfo = getBinaryInfo();
  const binaryPath: string = getBinaryPath();

  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  console.log(`🔍 Fluxion CLI not found. Installing...`);
  console.log(`📍 Platform: ${binaryInfo.platformName}`);

  // 首先尝试使用本地构建的二进制文件（开发模式）
  const localBinaryPath: string = join(
    __dirname,
    '..',
    'cli',
    'target',
    'release',
    platform() === 'win32' ? 'fluxion-cli.exe' : 'fluxion-cli',
  );

  if (existsSync(localBinaryPath)) {
    console.log(`📦 Using local development build...`);
    // 复制本地二进制文件
    const fs = await import('node:fs');
    fs.copyFileSync(localBinaryPath, binaryPath);
    await makeExecutable(binaryPath);
    console.log(`✅ Successfully installed from local build to ${binaryPath}`);
    return binaryPath;
  }

  try {
    const version: string = await getLatestVersion();
    console.log(`📦 Installing version ${version}...`);

    await downloadBinary(version, binaryInfo);
    await makeExecutable(binaryPath);

    console.log(`✅ Successfully installed to ${binaryPath}`);
    return binaryPath;
  } catch (error) {
    console.error(`❌ Failed to install binary: ${error}`);
    console.log(`💡 You can also manually download from: https://github.com/${GITHUB_REPO}/releases`);
    console.log(`💡 Or build locally: cd cli && cargo build --release`);
    throw error;
  }
}

async function checkForUpdates(): Promise<boolean> {
  try {
    const installedVersion: string | undefined = process.env.FLUXION_VERSION;
    if (!installedVersion) {
      return false;
    }

    const latestVersion: string = await getLatestVersion();
    return latestVersion !== installedVersion;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  try {
    // Check for updates in background
    checkForUpdates().then((hasUpdate: boolean) => {
      if (hasUpdate) {
        console.log('🔄 A new version is available. Run with --update to upgrade.');
      }
    });

    const binaryPath: string = await ensureBinary();
    const args: string[] = process.argv.slice(2);

    // Handle update command
    if (args.includes('--update')) {
      console.log('🔄 Updating to latest version...');
      const binaryInfo: BinaryInfo = getBinaryInfo();
      const version: string = await getLatestVersion();

      await downloadBinary(version, binaryInfo);
      await makeExecutable(getBinaryPath());
      console.log('✅ Update complete!');
      return;
    }

    // Execute the binary
    const child = spawn(binaryPath, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        FLUXION_INSTALLER: 'true',
      },
    });

    child.on('error', (error: Error) => {
      console.error(`Failed to start fluxion-cli: ${error.message}`);
      process.exit(1);
    });

    child.on('exit', (code: number | null) => {
      process.exit(code || 0);
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();