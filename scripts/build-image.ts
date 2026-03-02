import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bumpVersion } from './bump-version';

const pkgPath = path.resolve(import.meta.dirname, '..', '.image.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name: string; version: string };
const imageName = `${pkg.name}:${pkg.version}`;

execSync('pnpm build', { stdio: 'inherit' });
execSync(`docker build -t ${imageName} .`, { stdio: 'inherit' });

bumpVersion(pkgPath);
