import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import type { InstanceInfo } from './types.js';

export const FLUXION_HOME = resolve(homedir(), '.fluxion');
export const SOCKET_PATH = resolve(FLUXION_HOME, 'daemon.sock');
export const PID_PATH = resolve(FLUXION_HOME, 'daemon.pid');
export const INSTANCES_DIR = resolve(FLUXION_HOME, 'instances');
export const LOGS_DIR = resolve(FLUXION_HOME, 'logs');

export function ensureDirectories(): void {
  mkdirSync(INSTANCES_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
}

export function readPidFile(): number | null {
  try {
    return parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

export function writePidFile(pid: number): void {
  ensureDirectories();
  writeFileSync(PID_PATH, String(pid));
}

export function removePidFile(): void {
  try {
    unlinkSync(PID_PATH);
  } catch {
    // ignore
  }
}

export function removeSocketFile(): void {
  try {
    unlinkSync(SOCKET_PATH);
  } catch {
    // ignore
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

export function readInstanceFile(uid: string): InstanceInfo | null {
  const filePath = join(INSTANCES_DIR, `${uid}.json`);
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeInstanceFile(uid: string, info: InstanceInfo): void {
  ensureDirectories();
  const filePath = join(INSTANCES_DIR, `${uid}.json`);
  writeFileSync(filePath, JSON.stringify(info, null, 2));
}

export function removeInstanceFile(uid: string): void {
  try {
    unlinkSync(join(INSTANCES_DIR, `${uid}.json`));
  } catch {
    // ignore
  }
}

export function listInstanceFiles(): InstanceInfo[] {
  if (!existsSync(INSTANCES_DIR)) return [];
  return readdirSync(INSTANCES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(INSTANCES_DIR, f), 'utf-8')) as InstanceInfo;
      } catch {
        return null;
      }
    })
    .filter((x): x is InstanceInfo => x !== null);
}