#!/usr/bin/env tsx
import { parseCommand } from './parser.js';
import { executor } from './executor.js';

function main() {
  const command = parseCommand();
  executor(command);
}

main();
