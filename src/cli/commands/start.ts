import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { sendIpcMessage } from '../shared/ipc.js';
import { ensureDaemonRunning } from '../shared/utils.js';
import type { NormalizedFluxionInstanceOptions } from '../shared/types.js';

/**
 * Load config file via subprocess.
 * Uses tsx for .ts files, node for .js files.
 * The subprocess runs in CJS mode so `require()` works.
 */
function loadConfigFile(filePath: string): NormalizedFluxionInstanceOptions {
  const isTs = filePath.endsWith('.ts');
  const interpreter = isTs ? 'tsx' : process.execPath;

  // Subprocess script: require the config file, output JSON to stdout
  const loaderScript = [
    `const mod = require(${JSON.stringify(filePath)});`,
    `const config = mod.default || mod;`,
    `process.stdout.write(JSON.stringify({`,
    `  interpreter: config.interpreter || 'node',`,
    `  cwd: config.cwd || process.cwd(),`,
    `  entry: config.entry,`,
    `  maxRestarts: config.maxRestarts ?? 3,`,
    `  env: config.env || process.env`,
    `}));`,
  ].join('\n');

  const result = execSync(`${interpreter} -e ${JSON.stringify(loaderScript)}`, {
    encoding: 'utf-8',
    timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return JSON.parse(result.trim());
}

/**
 * Find config file in cwd, trying .fluxion.config.ts then .fluxion.config.js
 */
function findConfigFile(cwd: string): { path: string; config: NormalizedFluxionInstanceOptions } | null {
  const candidates = ['.fluxion.config.ts', '.fluxion.config.js'];
  for (const name of candidates) {
    const filePath = resolve(cwd, name);
    if (existsSync(filePath)) {
      try {
        const config = loadConfigFile(filePath);
        return { path: filePath, config };
      } catch (e) {
        console.error(`Error loading config file ${filePath}:`, e);
        return null;
      }
    }
  }
  return null;
}

export async function start(): Promise<void> {
  const cwd = process.cwd();

  // 1. Ensure daemon is running
  await ensureDaemonRunning();

  // 2. Find config file
  const found = findConfigFile(cwd);
  if (!found) {
    console.error('No .fluxion.config.ts or .fluxion.config.js found in current directory.');
    console.error('Run "fluxion init" to create one.');
    process.exit(1);
  }

  // 3. Send IPC message
  console.error(`Starting instance from ${found.path} ...`);
  try {
    const result = (await sendIpcMessage('start', {
      config: found.config,
    })) as { uid: string; pid: number };
    console.log(`Started ${result.uid} (pid ${result.pid})`);
  } catch (e) {
    console.error('Failed to start instance:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}