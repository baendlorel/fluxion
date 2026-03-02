import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// load image settings
const pkgPath = path.resolve(import.meta.dirname, '..', '.image.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name: string; version: string };
const imageName = `${pkg.name}:${pkg.version}`;

// 1. build
execSync('pnpm build', { stdio: 'inherit' });

// 2. docker
execSync(`docker build -t ${imageName} .`, { stdio: 'inherit' });

// 3. bump
const [major, minor, patch] = pkg.version.split('.').map(Number);
const nextVersion = [major, minor, patch + 1].join('.');
const oldVersion = pkg.version;
pkg.version = nextVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Bumped version: ${oldVersion} -> ${nextVersion}`);
