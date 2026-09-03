import { platform } from 'node:os';
import { spawn, type SpawnOptions } from 'node:child_process';
import { open, appendFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';

const dt = () => new Date().toLocaleString('zh-CN');
const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

class Daemon {
  readonly port: number;
  readonly cmd: string;
  readonly cmdArgs: string[];

  readonly checkInterval: number;
  /**
   * Wait this seconds. If the pid is still alive, kill -9.
   */
  readonly terminateWait: number;

  /**
   * `stdio` will be fixed to `['ignore', fileHandler.fd, fileHandler.fd]`
   */
  readonly spawnOptions: SpawnOptions;

  /**
   * Will append daemon logs into it.
   */
  readonly daemonfile: string;

  /**
   * Will append fluxion logs into it.
   */
  readonly instancefile: string;

  readonly isAlive: () => boolean | Promise<boolean>;

  readonly next: () => NodeJS.Timeout;

  pid: number | undefined;

  constructor() {
    if (platform() !== 'linux') {
      console.error('This daemon only supports Linux.');
      process.exit(1);
    }

    this.next = () => setTimeout(() => this.runner(), 1000 * this.checkInterval);
    console.log('Fluxion daemon started.');
  }

  private log(message: string) {
    appendFile(this.daemonfile, `${dt()} ${message}\n`, 'utf-8').catch(console.error);
  }

  private logSync(message: string) {
    appendFileSync(this.daemonfile, `${dt()} ${message}\n`, 'utf-8');
  }

  private async start() {
    const fileHandler = await open(this.instancefile, 'a');

    const opts: SpawnOptions = {
      ...this.spawnOptions,
      stdio: ['ignore', fileHandler.fd, fileHandler.fd],
    };
    if (opts.env) {
      opts.env.FLUXION_PORT = this.port.toString();
    }

    const child = spawn(this.cmd, this.cmdArgs, opts as SpawnOptions);

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

    await wait(this.terminateWait);
    if (this.isPidAlive()) {
      process.kill(this.pid, 'SIGKILL');
    }
    await wait(1);

    this.pid = undefined;
  }

  async runner() {
    if (!this.isPidAlive()) {
      this.log(`No instance running, starting.`);
      await this.start();
      await wait(1);
      this.next();
      return;
    }

    const ok = await Promise.try(this.isAlive).catch(() => false);

    if (!ok) {
      await this.kill();
      await this.start();
      await wait(1);
    }
    this.next();
  }
}

// # ON close
process.on('SIGINT', () => console.log('SIGINT'));
process.on('SIGTERM', () => console.log('SIGTERM'));
process.on('SIGQUIT', () => console.log('SIGQUIT'));
