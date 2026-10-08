import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function bumpVersion(pkgPath: string = path.resolve(import.meta.dirname, '..', 'package.json')) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name: string; version: string };
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  const nextVersion = [major, minor, patch + 1].join('.');
  const oldVersion = pkg.version;
  pkg.version = nextVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Bumped version: ${oldVersion} -> ${nextVersion}`);
}
