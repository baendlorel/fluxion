#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fluxion } from '../fluxion.js';
import { parseCommand } from './parser.js';

function main() {
  const { command, options } = parseCommand();
}

main();
