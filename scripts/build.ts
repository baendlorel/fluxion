import { execSync } from 'node:child_process';

export function build() {
  const isDev = process.argv.includes('--dev');

  console.log('🔨 Building TypeScript...');
  execSync('tsdown', { stdio: 'inherit', env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production' } });
}
