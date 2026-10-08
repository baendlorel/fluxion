import { execSync } from 'node:child_process';
import { bumpVersion } from './bump-version.js';

export function publish() {
  bumpVersion();
  execSync('pnpm publish --registry https://registry.npmjs.org/  --access public --no-git-checks', {
    stdio: 'inherit',
  });
}
