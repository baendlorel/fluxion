import { build } from './build.js';
import { publish } from './publish.js';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--build')) {
  const buildCli = process.argv.includes('--cli');
  build();

  // 如果需要构建 CLI，同时构建 wrapper
  if (buildCli) {
    buildWrapper();
  }
} else if (process.argv.includes('--publish')) {
  build();
  publish();
}

function buildWrapper() {
  const wrapperSrc = join(process.cwd(), 'scripts', 'wrapper.ts');
  const wrapperDest = join(process.cwd(), 'dist', 'wrapper.mjs');

  if (existsSync(wrapperSrc)) {
    console.log('📦 Building CLI wrapper...');
    execSync(`npx tsx ${wrapperSrc} --build`, {
      stdio: 'inherit',
      env: { ...process.env, BUILD_TARGET: wrapperDest }
    });

    // 直接复制到 dist 目录
    execSync(`cp ${wrapperSrc} ${wrapperDest}`, { stdio: 'inherit' });
    console.log('✅ CLI wrapper built successfully');
  } else {
    console.warn('⚠️  wrapper.ts not found, skipping wrapper build');
  }
}
