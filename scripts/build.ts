import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 目标平台配置
const TARGETS = [
  { platform: 'linux', arch: 'x86_64', rust: 'x86_64-unknown-linux-gnu', name: 'linux-x64' },
  { platform: 'linux', arch: 'aarch64', rust: 'aarch64-unknown-linux-gnu', name: 'linux-arm64' },
  { platform: 'darwin', arch: 'x86_64', rust: 'x86_64-apple-darwin', name: 'darwin-x64' },
  { platform: 'darwin', arch: 'aarch64', rust: 'aarch64-apple-darwin', name: 'darwin-arm64' },
  { platform: 'win32', arch: 'x86_64', rust: 'x86_64-pc-windows-msvc', name: 'win-x64' },
  { platform: 'win32', arch: 'aarch64', rust: 'aarch64-pc-windows-msvc', name: 'win-arm64' },
];

export function build() {
  const isDev = process.argv.includes('--dev');
  const buildCli = process.argv.includes('--cli');

  // 构建 TypeScript 部分
  console.log('🔨 Building TypeScript...');
  execSync('tsdown', { stdio: 'inherit', env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production' } });

  // 如果指定了 --cli 参数，则构建 Rust CLI
  if (buildCli) {
    console.log('🦀 Building Rust CLI for multiple platforms...');
    buildRustCli();
  }
}

function buildRustCli() {
  const cliDir = join(process.cwd(), 'cli');
  const distDir = join(process.cwd(), 'dist', 'bin');

  // 创建输出目录
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  // 检查是否在 CLI 目录中
  if (!existsSync(cliDir)) {
    console.warn('⚠️  CLI directory not found, skipping Rust CLI build');
    return;
  }

  console.log('📦 Building Rust CLI binaries...');

  // 为每个目标平台构建
  for (const target of TARGETS) {
    try {
      console.log(`   Building for ${target.name} (${target.rust})...`);

      const buildCmd = `cargo build --release --target ${target.rust}`;
      execSync(buildCmd, {
        cwd: cliDir,
        stdio: 'inherit',
      });

      // 复制二进制文件到 dist 目录
      let binaryName = 'fluxion-cli';
      if (target.platform === 'win32') {
        binaryName = 'fluxion-cli.exe';
      }

      const sourcePath = join(cliDir, 'target', target.rust, 'release', binaryName);
      const targetPath = join(distDir, `fluxion-${target.name}${target.platform === 'win32' ? '.exe' : ''}`);

      if (existsSync(sourcePath)) {
        execSync(`cp ${sourcePath} ${targetPath}`, { stdio: 'inherit' });
        console.log(`   ✅ Built ${target.name}`);
      } else {
        console.warn(`   ⚠️  Binary not found for ${target.name}, skipping`);
      }
    } catch (error) {
      console.warn(`   ❌ Failed to build for ${target.name}:`, error);
    }
  }

  console.log('🎉 Rust CLI build complete!');
  console.log(`📁 Binaries available in: ${distDir}`);
}
