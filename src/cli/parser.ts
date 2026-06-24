import type { FluxionCommand } from './types.js';
import { quit } from './utils.js';

export function parseCommand() {
  const OPTS = ['config'];
  const CMDS = [null, 'status', 'stop', 'logs'];

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
      options.push({ option: key, value: args[i + 1] ?? null });
      continue;
    }

    if (command !== null) {
      quit(`Already detect a command [${command}], but now got [${a}]`);
    }
    command = a;
  }

  // # Validating

  if (!CMDS.includes(command)) {
    quit(`Unknown command [${command}], please use one of [${CMDS.join(', ')}]`);
  }

  options.forEach((v) => {
    if (!OPTS.includes(v.option)) {
      quit(`Unknown option [${v.option}], please use one of [${OPTS.join(', ')}]`);
    }
  });

  return { command, options } as FluxionCommand;
}
