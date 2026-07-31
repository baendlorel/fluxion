import { execSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 目标平台配置
const TARGETS = [
  { platform: 'linux', arch: 'x86_64', rust: 'x86_64-unknown-linux-gnu', name: 'linux-x64', ext: '' },
  { platform: 'linux', arch: 'aarch64', rust: 'aarch64-unknown-linux-gnu', name: 'linux-arm64', ext: '' },
  { platform: 'darwin', arch: 'x86_64', rust: 'x86_64-apple-darwin', name: 'darwin-x64', ext: '' },
  { platform: 'darwin', arch: 'aarch64', rust: 'aarch64-apple-darwin', name: 'darwin-arm64', ext: '' },
  { platform: 'win32', arch: 'x86_64', rust: 'x86_64-pc-windows-msvc', name: 'win-x64', ext: '.exe' },
  { platform: 'win32', arch: 'aarch64', rust: 'aarch64-pc-windows-msvc', name: 'win-arm64', ext: '.exe' },
];

async function main() {
  console.log('🦀 Starting Rust CLI cross-platform build...\n');

  const projectRoot = join(__dirname, '..');
  const cliDir = join(projectRoot, 'cli');
  const distDir = join(projectRoot, 'dist', 'bin');

  if (!existsSync(cliDir)) {
    console.error('❌ CLI directory not found. Please ensure the cli folder exists.');
    process.exit(1);
  }

  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
    console.log('📁 Created dist/bin directory');
  }

  console.log('\n🔧 Adding Rust targets...');
  await addRustTargets();

  console.log('\n🔨 Building CLI binaries...');
  await buildCli(cliDir, distDir);

  console.log('\n📦 Creating platform-specific bin configurations...');
  createBinConfig(distDir);

  console.log('\n✅ CLI build complete!');
  console.log(`📁 Binaries available in: ${distDir}`);
  console.log('\n💡 Usage:');
  console.log('   npm run build:cli      - Build all platforms');
  console.log('   npx fluxion-cli       - Run via node wrapper');
}

async function addRustTargets() {
  const targetsToAdd = TARGETS.map((t) => t.rust);

  for (const target of targetsToAdd) {
    try {
      console.log(`   Adding target: ${target}`);
      execSync(`rustup target add ${target}`, { stdio: 'pipe' });
      console.log(`   ✅ Added ${target}`);
    } catch (error) {
      console.warn(`   ⚠️  Failed to add ${target}, may already exist or rustup not available`);
    }
  }
}

async function buildCli(cliDir: string, distDir: string) {
  for (const target of TARGETS) {
    try {
      console.log(`\n📦 Building for ${target.name} (${target.rust})...`);

      const buildCmd = `cargo build --release --target ${target.rust}`;
      execSync(buildCmd, {
        cwd: cliDir,
        stdio: 'inherit',
        env: { ...process.env },
      });

      const binaryName = `fluxion-cli${target.ext}`;
      const sourcePath = join(cliDir, 'target', target.rust, 'release', binaryName);
      const targetPath = join(distDir, `fluxion-${target.name}${target.ext}`);

      if (existsSync(sourcePath)) {
        execSync(`cp "${sourcePath}" "${targetPath}"`, { stdio: 'inherit' });
        console.log(`   ✅ Built ${target.name}`);
      } else {
        console.warn(`   ⚠️  Binary not found for ${target.name}, skipping`);
      }

      if (target.name === 'linux-arm64') {
        console.log('   💡 Note: linux-arm64 build may require cross-compilation tools');
      }
    } catch (error) {
      console.warn(`   ❌ Failed to build for ${target.name}`);
      console.warn('   This may require additional cross-compilation setup');
    }
  }
}

function createBinConfig(distDir: string) {
  const availableBins = [];

  for (const target of TARGETS) {
    const binaryPath = join(distDir, `fluxion-${target.name}${target.ext}`);
    if (existsSync(binaryPath)) {
      availableBins.push({
        platform: target.platform,
        arch: target.arch,
        path: `./dist/bin/fluxion-${target.name}${target.ext}`,
      });
    }
  }

  if (availableBins.length > 0) {
    console.log('\n📋 Available binary configurations:');
    availableBins.forEach((bin) => {
      console.log(`   ${bin.platform}-${bin.arch}: ${bin.path}`);
    });

    const configPath = join(distDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ bins: availableBins }, null, 2));
    console.log(`\n📄 Configuration written to: ${configPath}`);
  } else {
    console.warn('\n⚠️  No binaries were successfully built');
  }
}

main().catch(console.error);
