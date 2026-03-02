import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const pkgPath = path.resolve(import.meta.dirname, '../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const version: string = pkg.version;
const imageName = `fluxion:${version}`;

// 1. build
execSync('pnpm build', { stdio: 'inherit' });

// 2. docker
execSync(`docker build -t ${imageName} .`, { stdio: 'inherit' });

// 3. bump
const [major, minor, patch] = version.split('.').map(Number);
const nextVersion = [major, minor, patch + 1].join('.');
pkg.version = nextVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Bumped version: ${version} -> ${nextVersion}`);
