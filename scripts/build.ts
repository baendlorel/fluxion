import { execSync } from 'node:child_process';

export function build() {
  const isDev = process.argv.includes('--dev');
  execSync('tsdown', { stdio: 'inherit', env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production' } });
}
