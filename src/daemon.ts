import { spawn, type SpawnOptions } from 'node:child_process';
import { open, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const dt = () => new Date().toLocaleString('zh-CN');
const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

interface DaemonOptions {
  /**
   * Default is 9335
   */
  port?: number;

  /**
   * 1st argument of `spawn` from `node:child_process`.
   */
  cmd: string;

  /**
   * 2nd argument of `spawn` from `node:child_process`.
   */
  cmdArgs?: string[];

  /**
   * 3rd argument of `spawn` from `node:child_process`.
   *
   * **Note**: `stdio` is fixed to `['ignore', fileHandler.fd, fileHandler.fd]`
   */
  spawnOptions?: SpawnOptions;

  /**
   * Default is 30 seconds.
   */
  checkInterval?: number;

  /**
   * Wait this seconds. If the pid is still alive, kill -9.
   *
   * Default is 5 seconds.
   */
  terminateWait?: number;

  /**
   * Will append daemon logs into `<logsDir>/daemon.log`.
   * Will append fluxion logs into `<logsDir>/instance.log`.
   */
  logsDir: string;

  /**
   * Custom checker returns whether the instance is alive.
   * - if not provided, the daemon will only checks whether the pid is alive.
   * @returns `true` if alive, `false` otherwise.
   */
  isAlive?: () => boolean | Promise<boolean>;
}

class Daemon {
  readonly opts: Required<DaemonOptions>;

  readonly daemonfile: string;
  readonly instancefile: string;

  readonly next: () => NodeJS.Timeout;

  pid: number | undefined;

  constructor(options: DaemonOptions) {
    this.opts = {
      port: 9335,
      checkInterval: 30,
      terminateWait: 5,
      cmdArgs: [],
      spawnOptions: {},
      isAlive: () => true,
      ...options,
    };

    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      _throw('DaemonOptions must be an object');
    }

    if (typeof this.opts.cmd !== 'string' || this.opts.cmd.length === 0) {
      _throw('DaemonOptions.cmd must be a non-empty string');
    }

    if (typeof this.opts.logsDir !== 'string' || this.opts.logsDir.length === 0) {
      _throw('DaemonOptions.logsDir must be a non-empty string');
    }

    if (typeof this.opts.port !== 'number' || !Number.isSafeInteger(this.opts.port)) {
      _throw('DaemonOptions.port must be a positive integer');
    }

    if (this.opts.port < 1 || this.opts.port > 65535) {
      _throw('DaemonOptions.port must be 1 ~ 65535');
    }

    if (!Array.isArray(this.opts.cmdArgs) || this.opts.cmdArgs.some((a) => typeof a !== 'string')) {
      _throw('DaemonOptions.cmdArgs must be an array of strings');
    }

    if (
      typeof this.opts.spawnOptions !== 'object' ||
      this.opts.spawnOptions === null ||
      Array.isArray(this.opts.spawnOptions)
    ) {
      _throw('DaemonOptions.spawnOptions must be an object');
    }

    if (!Number.isSafeInteger(this.opts.checkInterval) || this.opts.checkInterval <= 0) {
      _throw('DaemonOptions.checkInterval must be an integer greater than 0');
    }

    if (!Number.isSafeInteger(this.opts.terminateWait) || this.opts.terminateWait < 0) {
      _throw('DaemonOptions.terminateWait must be a non-negative integer');
    }

    if (typeof this.opts.isAlive !== 'function') {
      _throw('DaemonOptions.isAlive must be a function');
    }

    this.daemonfile = join(this.opts.logsDir, `daemon.log`);
    this.instancefile = join(this.opts.logsDir, `instance.log`);

    this.next = () => setTimeout(() => this.run(), 1000 * this.opts.checkInterval);
    console.log('Fluxion daemon started.');
  }

  private log(message: string) {
    appendFile(this.daemonfile, `${dt()} ${message}\n`, 'utf-8').catch(console.error);
  }

  private async start() {
    const fileHandler = await open(this.instancefile, 'a');

    const opts: SpawnOptions = {
      ...this.opts.spawnOptions,
      stdio: ['ignore', fileHandler.fd, fileHandler.fd],
    };
    if (opts.env) {
      opts.env.FLUXION_PORT = this.opts.port.toString();
    }

    const child = spawn(this.opts.cmd, this.opts.cmdArgs, opts as SpawnOptions);

    const closer = (tag: string) => {
      fileHandler.close().catch(() => {});
      this.log(tag);
      this.pid = undefined;
    };

    child.on('close', () => closer('close'));
    child.on('exit', () => closer('exit'));
    child.on('disconnect', () => closer('disconnect'));
    child.on('error', (e) => closer(e.message));

    this.log(`fluxion spawned, pid: ${(this.pid = child.pid)}`);
    child.unref();
  }

  private isPidAlive(pid = this.pid, signal = 0): boolean {
    if (!pid) {
      return false;
    }
    try {
      process.kill(pid, signal);
      return true;
    } catch (e) {
      if (e instanceof Error === false) {
        return false;
      }
      if ((e as any).code === 'ESRCH') {
        this.log(`进程 ${pid} 已不存在`);
        return false;
      } else if ((e as any).code === 'EPERM') {
        this.log(`进程 ${pid} 存在但无权限操作`);
        return true;
      } else {
        return false;
      }
    }
  }

  private async kill(signal = 'SIGTERM') {
    if (!this.pid) {
      return;
    }

    try {
      process.kill(this.pid, signal);
    } catch (e) {
      this.log(`Failed to kill process ${this.pid}: ${(e as Error).message}`);
    }

    await wait(this.opts.terminateWait);
    if (this.isPidAlive()) {
      process.kill(this.pid, 'SIGKILL');
    }
    await wait(1);

    this.pid = undefined;
  }

  async run() {
    if (!this.isPidAlive()) {
      this.log(`No instance running, starting.`);
      await this.start();
      await wait(1);
      this.next();
      return;
    }

    const ok = await Promise.try(this.opts.isAlive).catch(() => false);

    if (!ok) {
      await this.kill();
      await this.start();
      await wait(1);
    }
    this.next();
  }
}

export function launchDaemon(opts: DaemonOptions) {
  const daemon = new Daemon(opts);
  daemon.run();
  return daemon;
}
