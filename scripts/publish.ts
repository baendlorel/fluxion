import { execSync } from 'node:child_process';
import { bumpVersion } from './bump-version';

bumpVersion();
execSync('pnpm build', { stdio: 'inherit' });
execSync('pnpm publish --access public', { stdio: 'inherit' });
