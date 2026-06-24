#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fluxion } from './fluxion.js';

async function main() {
  const [, , ...argv0] = process.argv;
  const argv = [...argv0];
  const command = argv[0] === 'stop' || argv[0] === 'restart' || argv[0] === 'status' ? argv.shift()! : 'start';
  const appMode = argv[0] === '__app';
  const supervisorMode = argv[0] === '__supervisor';
  if (appMode || supervisorMode) {
    argv.shift();
  }

  let configPath = '';
  let daemon = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config') {
      configPath = argv[++i] ?? '';
      continue;
    }
    if (arg === '--daemon') {
      daemon = true;
      continue;
    }
    $throw(`Unknown argument: ${arg}`);
  }

  if (!configPath) {
    $throw('Missing required argument: --config <path>');
  }

  const resolvedConfigPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedConfigPath)) {
    $throw(`Config file not found: ${resolvedConfigPath}`);
  }

  const runtimeDir = path.join(process.cwd(), '.fluxion');
  const configHash = createHash('sha1').update(resolvedConfigPath).digest('hex');
  const statusFile = path.join(runtimeDir, `${configHash}.json`);
  const outLog = path.join(runtimeDir, `${configHash}.out.log`);
  const errLog = path.join(runtimeDir, `${configHash}.err.log`);
  const cliPath = path.resolve(process.argv[1]);
  const tsxImport = pathToFileURL(require.resolve('tsx')).href;

  const readStatus = () => {
    if (!fs.existsSync(statusFile)) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(statusFile, 'utf8')) as {
      configPath: string;
      supervisorPid?: number;
      appPid?: number;
      state: 'starting' | 'running' | 'stopped' | 'failed';
      restartCount: number;
      updatedAt: number;
    };
  };

  const writeStatus = (next: {
    configPath: string;
    supervisorPid?: number;
    appPid?: number;
    state: 'starting' | 'running' | 'stopped' | 'failed';
    restartCount: number;
    updatedAt: number;
  }) => {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(statusFile, JSON.stringify(next, null, 2));
  };

  const isAlive = (pid?: number) => {
    if (!pid) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  if (appMode) {
    const mod = await import(pathToFileURL(resolvedConfigPath).href);
    if (typeof mod.config !== 'object' || mod.config === null || Array.isArray(mod.config)) {
      $throw(`Config file must export const config. Recommended: export const config = defineFluxionOptions({...})`);
    }
    await fluxion(mod.config);
    return;
  }

  if (supervisorMode) {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const out = fs.openSync(outLog, 'a');
    const err = fs.openSync(errLog, 'a');
    const execArgv = ['--import', tsxImport];
    let stopping = false;
    let restarting: number[] = [];
    let app = spawn(process.execPath, [...execArgv, cliPath, '__app', '--config', resolvedConfigPath], {
      detached: false,
      stdio: ['ignore', out, err],
      env: process.env,
    });

    writeStatus({
      configPath: resolvedConfigPath,
      supervisorPid: process.pid,
      appPid: app.pid,
      state: 'starting',
      restartCount: 0,
      updatedAt: Date.now(),
    });

    const stopApp = () => {
      if (!app.pid || !isAlive(app.pid)) {
        return;
      }
      app.kill('SIGTERM');
      setTimeout(() => {
        if (app.pid && isAlive(app.pid)) {
          app.kill('SIGKILL');
        }
      }, 10_000).unref();
    };

    const stopSupervisor = () => {
      stopping = true;
      writeStatus({
        configPath: resolvedConfigPath,
        supervisorPid: process.pid,
        appPid: app.pid,
        state: 'stopped',
        restartCount: restarting.length,
        updatedAt: Date.now(),
      });
      stopApp();
    };

    process.once('SIGINT', stopSupervisor);
    process.once('SIGTERM', stopSupervisor);

    const bindRunning = () => {
      app.on('spawn', () => {
        writeStatus({
          configPath: resolvedConfigPath,
          supervisorPid: process.pid,
          appPid: app.pid,
          state: 'running',
          restartCount: restarting.length,
          updatedAt: Date.now(),
        });
      });
    };

    bindRunning();

    app.on('exit', (code, signal) => {
      if (stopping) {
        process.exit(code ?? 0);
      }

      restarting = restarting.filter((at) => Date.now() - at < 60_000);
      restarting.push(Date.now());
      if (restarting.length > 3) {
        writeStatus({
          configPath: resolvedConfigPath,
          supervisorPid: process.pid,
          appPid: undefined,
          state: 'failed',
          restartCount: restarting.length,
          updatedAt: Date.now(),
        });
        process.exit(code ?? (signal ? 1 : 0));
      }

      app = spawn(process.execPath, [...execArgv, cliPath, '__app', '--config', resolvedConfigPath], {
        detached: false,
        stdio: ['ignore', out, err],
        env: process.env,
      });
      writeStatus({
        configPath: resolvedConfigPath,
        supervisorPid: process.pid,
        appPid: app.pid,
        state: 'starting',
        restartCount: restarting.length,
        updatedAt: Date.now(),
      });
      bindRunning();
    });

    return;
  }

  if (command === 'status') {
    const status = readStatus();
    if (!status) {
      console.log('stopped');
      process.exit(0);
    }
    const supervisorAlive = isAlive(status.supervisorPid);
    const appAlive = isAlive(status.appPid);
    console.log(
      JSON.stringify(
        {
          ...status,
          supervisorAlive,
          appAlive,
          state: supervisorAlive
            ? status.state
            : status.state === 'failed'
              ? 'failed'
              : status.state === 'stopped'
                ? 'stopped'
                : 'stale',
        },
        null,
        2,
      ),
    );
    process.exit(supervisorAlive || appAlive ? 0 : 1);
  }

  if (command === 'stop') {
    const status = readStatus();
    if (!status) {
      console.log('Already stopped');
      process.exit(0);
    }
    if (status.supervisorPid && isAlive(status.supervisorPid)) {
      process.kill(status.supervisorPid, 'SIGTERM');
    } else if (status.appPid && isAlive(status.appPid)) {
      process.kill(status.appPid, 'SIGTERM');
    }
    writeStatus({
      configPath: resolvedConfigPath,
      supervisorPid: status.supervisorPid,
      appPid: status.appPid,
      state: 'stopped',
      restartCount: status.restartCount,
      updatedAt: Date.now(),
    });
    console.log('Stopped');
    process.exit(0);
  }

  if (command === 'restart') {
    const status = readStatus();
    if (status?.supervisorPid && isAlive(status.supervisorPid)) {
      process.kill(status.supervisorPid, 'SIGTERM');
    } else if (status?.appPid && isAlive(status.appPid)) {
      process.kill(status.appPid, 'SIGTERM');
    }
    writeStatus({
      configPath: resolvedConfigPath,
      supervisorPid: undefined,
      appPid: undefined,
      state: 'stopped',
      restartCount: status?.restartCount ?? 0,
      updatedAt: Date.now(),
    });
    daemon = true;
  }

  if (!daemon) {
    const child = spawn(process.execPath, ['--import', tsxImport, cliPath, '__app', '--config', resolvedConfigPath], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code, signal) => {
      process.exit(code ?? (signal ? 1 : 0));
    });
    return;
  }

  const current = readStatus();
  if (
    current &&
    ((current.supervisorPid && isAlive(current.supervisorPid)) || (current.appPid && isAlive(current.appPid)))
  ) {
    $throw(`Fluxion is already running for config: ${resolvedConfigPath}`);
  }

  fs.mkdirSync(runtimeDir, { recursive: true });
  writeStatus({
    configPath: resolvedConfigPath,
    supervisorPid: undefined,
    appPid: undefined,
    state: 'starting',
    restartCount: 0,
    updatedAt: Date.now(),
  });

  const supervisor = spawn(process.execPath, [cliPath, '__supervisor', '--config', resolvedConfigPath], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });

  supervisor.unref();
  console.log(
    JSON.stringify(
      {
        configPath: resolvedConfigPath,
        supervisorPid: supervisor.pid,
        statusFile,
        outLog,
        errLog,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
