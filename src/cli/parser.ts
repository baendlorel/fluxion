import type { FluxionCommand } from './types.js';
import { quit } from './utils.js';

function validate(command: string | null, options: Array<{ option: string; value: string | null }>): FluxionCommand {
  const OPTS = ['config'];
  const CMDS = [null, 'status', 'stop', 'logs'];

  // # Validating

  if (!CMDS.includes(command)) {
    quit(`Unknown command [${command}], please use one of [${CMDS.join(', ')}]`);
  }

  options.forEach((v) => {
    if (!OPTS.includes(v.option)) {
      quit(`Unknown option [${v.option}], please use one of [${OPTS.join(', ')}]`);
    }
  });

  if (command === null) {
    if (options.length !== 1) {
      quit('Command [start] requires exactly one option [--config]');
    }

    const config = options[0];
    if (config.option !== 'config') {
      quit('Only accepts option [--config]');
    }

    if (config.value === null || config.value.trim() === '') {
      quit('Option [--config] requires a non-empty value');
    }

    return {
      command: null,
      options: [{ option: 'config', value: config.value }],
    };
  }

  if (command === 'status') {
    if (options.length !== 0) {
      quit(`Command [${command}] does not accept any options`);
    }

    return { command: 'status', options: [] };
  }

  if (command === 'stop') {
    if (options.length !== 0) {
      quit(`Command [${command}] does not accept any options`);
    }

    return { command: 'stop', options: [] };
  }

  if (command === 'stop') {
    if (options.length !== 0) {
      quit(`Command [${command}] does not accept any options`);
    }
    return { command: 'logs', options: [] };
  }

  // ! Normally nothing needed
  quit('Unknown command');
}

export function parseCommand(): FluxionCommand {
  const args = process.argv.slice(2);

  const options: Array<{ option: string; value: string | null }> = [];
  let command: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // deal with an option
    if (a.startsWith('--')) {
      let key = '';
      let value = null;
      if (a.includes('=')) {
        [key, value] = a.slice(2).split('=', 2);
      } else {
        key = a.slice(2);
        value = args[i + 1] ?? null;
        i++;
      }
      if (options.some((v) => v.option === key)) {
        quit(`Duplicate option [${key}]`);
      }
      options.push({ option: key, value });
      continue;
    }

    if (command !== null) {
      quit(`Already detect a command [${command}], but now got [${a}]`);
    }
    command = a;
  }

  return validate(command, options);
}
