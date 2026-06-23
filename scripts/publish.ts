import { execSync } from 'node:child_process';
import { bumpVersion } from './bump-version';

export function publish() {
  bumpVersion();
  execSync('pnpm publish --access public --no-git-checks', { stdio: 'inherit' });
}
