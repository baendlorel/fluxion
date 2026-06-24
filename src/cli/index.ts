#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fluxion } from '../fluxion.js';
import { parseCommand } from './parser.js';
import { executor } from './executor.js';

function main() {
  const command = parseCommand();
  executor(command);
}

main();
