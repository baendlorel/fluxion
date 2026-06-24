import path from 'node:path';
import { FluxionCommand } from './types.js';
import { fluxion } from '@/fluxion.js';

export function executor(command: FluxionCommand) {
  if (command.name === null) {
    let configPath = command.options.find((v) => v.option === 'config')?.value ?? 'fluxion.config.ts';
    configPath = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath);
    const config = require(configPath);
    fluxion(config.default);
  }
}
