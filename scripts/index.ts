import { build } from './build.js';
import { publish } from './publish.js';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--build')) {
  build();
  buildInstaller();
} else if (process.argv.includes('--publish')) {
  build();
  buildInstaller();
  publish();
}

function buildInstaller() {
  console.log('📦 Building installer...');

  const installerSrc = join(process.cwd(), 'scripts', 'installer.ts');
  const installerDir = join(process.cwd(), 'dist', 'installer');

  if (!existsSync(installerSrc)) {
    console.warn('⚠️  installer.ts not found, skipping installer build');
    return;
  }

  // 创建 installer 目录
  if (!existsSync(installerDir)) {
    mkdirSync(installerDir, { recursive: true });
  }

  // 复制安装器到 dist 目录
  const installerDest = join(installerDir, 'index.mjs');
  copyFileSync(installerSrc, installerDest);

  console.log('✅ Installer built successfully');
  console.log(`📁 Installer location: ${installerDest}`);
}
