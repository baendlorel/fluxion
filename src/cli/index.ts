#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fluxion } from '../fluxion.js';

function parseCommand() {
  const args = process.argv.slice(2);

  const options: Array<{ option: string; value: string | null }> = [];
  let command: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // deal with an option
    if (a.startsWith('--')) {
      if (a.includes('=')) {
        const [key, value] = a.slice(2).split('=');
        options.push({ option: key, value });
      } else {
        options.push({ option: a.slice(2), value: args[i + 1] ?? null });
        i++;
      }
      continue;
    }

    if (command !== null) {
      $throw(`Already detect a command [${command}], but now got [${a}]`);
    }
    command = a;
  }

  return { command, options };
}

function main() {}

main();
