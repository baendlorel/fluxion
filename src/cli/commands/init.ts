import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE = `import { defineFluxionInstance } from 'fluxion';

export default defineFluxionInstance({
  interpreter: 'tsx',
  entry: 'src/index.ts',
  maxRestarts: 3,
});
`;

export function init(): void {
  const cwd = process.cwd();
  const filePath = resolve(cwd, '.fluxion.config.ts');

  if (existsSync(filePath)) {
    console.error('.fluxion.config.ts already exists in this directory.');
    process.exit(1);
  }

  writeFileSync(filePath, TEMPLATE, 'utf-8');
  console.log(`Created ${filePath}`);
  console.log('Edit it to configure your Fluxion instance, then run:');
  console.log('  fluxion start');
}