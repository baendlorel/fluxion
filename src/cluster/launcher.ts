import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface FluxionInstanceRecord {
  startTime: number;
  pid: number;
  host: string;
  port: number;
  metaPort: number;
  cwd: string;

  configPath: string; // This will be used as an identifier
}

interface InstanceJson {
  instances: FluxionInstanceRecord[];
}

/**
 * Aim to avoid creating duplicated instances
 * and make it smoother for pm2's process management
 */
export class FluxionInstanceManager {
  private readonly instanceFilePath: string;
  private isUnregistering = false;
  private static readonly KILL_POLL_INTERVAL_MS = 300;
  private static readonly SIGTERM_TIMEOUT_MS = 10_000;
  private static readonly SIGKILL_TIMEOUT_MS = 1_000;

  constructor() {
    const dir = path.join(os.homedir(), '.fluxion');
    this.instanceFilePath = path.join(dir, 'instances.json');

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    process.on('exit', () => this.unregister());
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read the living processes
   */
  readAlive(): FluxionInstanceRecord[] {
    let result: FluxionInstanceRecord[] = [];
    try {
      if (fs.existsSync(this.instanceFilePath)) {
        const content = fs.readFileSync(this.instanceFilePath, 'utf-8');
        const data: InstanceJson = JSON.parse(content);
        if (data.instances !== undefined && !Array.isArray(data.instances)) {
          console.error(
            `[FluxionInstanceManager] 'instances' of ${this.instanceFilePath} is not an array. It seems that the record file is corrupted`,
          );
          result = [];
        }
        result = data.instances || [];
      }
    } catch (e) {
      console.error(`[FluxionInstanceManager] Failed to read instance.json:`, e);
    }

    return result.filter((instance) => this.isAlive(instance.pid));
  }

  /**
   * 写入实例记录
   * @param instances 实例记录数组
   */
  private update(instances: FluxionInstanceRecord[]): void {
    try {
      const data: InstanceJson = { instances };
      fs.writeFileSync(this.instanceFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[FluxionInstanceManager] Failed to write instance.json:', error);
    }
  }

  private async waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
    const maxAttempts = Math.ceil(timeoutMs / FluxionInstanceManager.KILL_POLL_INTERVAL_MS);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (!this.isAlive(pid)) {
        return true;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, FluxionInstanceManager.KILL_POLL_INTERVAL_MS);
      });
    }

    return !this.isAlive(pid);
  }

  private async kill(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      console.error(`[FluxionInstanceManager] Failed to kill process ${pid}:`, error);
      return false;
    }

    if (await this.waitForExit(pid, FluxionInstanceManager.SIGTERM_TIMEOUT_MS)) {
      return true;
    }

    console.warn(`[FluxionInstanceManager] Process ${pid} did not exit after SIGTERM, sending SIGKILL`);

    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      console.error(`[FluxionInstanceManager] Failed to force kill process ${pid}:`, error);
      return false;
    }

    return this.waitForExit(pid, FluxionInstanceManager.SIGKILL_TIMEOUT_MS);
  }

  async register(configPath: string, host: string, port: number, metaPort: number): Promise<void> {
    const currentPid = process.pid;
    const cwd = process.cwd();

    const duplicate = this.readAlive().find((instance) => instance.configPath === configPath);
    if (duplicate) {
      console.warn(
        `[FluxionInstanceManager] Found existing instance with same config or port: PID=${duplicate.pid}, PORT=${duplicate.port}`,
      );

      if (!(await this.kill(duplicate.pid))) {
        throw new Error(`[FluxionInstanceManager] Failed to stop old process ${duplicate.pid}`);
      }

      console.warn(`[FluxionInstanceManager] Killed old process ${duplicate.pid}`);

      const instances = this.readAlive();
      const filtered = instances.filter((instance) => instance.pid !== duplicate.pid);
      this.update(filtered);
    }

    const instances = this.readAlive().filter((instance) => instance.pid !== currentPid);

    const newRecord: FluxionInstanceRecord = {
      startTime: Date.now(),
      pid: currentPid,
      host,
      port,
      metaPort,
      cwd,
      configPath,
    };
    instances.push(newRecord);

    this.update(instances);

    console.info(`[FluxionInstanceManager] Registered instance: PID=${currentPid}, PORT=${port}, PATH=${configPath}`);
  }

  unregister(): void {
    if (this.isUnregistering) {
      return;
    }
    this.isUnregistering = true;

    const currentPid = process.pid;
    try {
      const instances = this.readAlive();
      const filtered = instances.filter((instance) => instance.pid !== currentPid);

      if (filtered.length !== instances.length) {
        this.update(filtered);
        console.info(`[FluxionInstanceManager] Unregistered instance: PID=${currentPid}`);
      }
    } finally {
      this.isUnregistering = false;
    }
  }

  print(): void {
    const instances = this.readAlive();
    console.info('[FluxionInstanceManager] Current instances:');
    for (const instance of instances) {
      console.info(
        `  - PID: ${instance.pid}, PORT: ${instance.port}, PATH: ${instance.configPath}, START: ${new Date(instance.startTime).toISOString()}`,
      );
    }
  }
}

export const instanceManager: FluxionInstanceManager = new FluxionInstanceManager();

export async function launchFluxionInstance(configPath: string, host: string, port: number, metaPort: number) {
  await instanceManager.register(configPath, host, port, metaPort);
}

export async function cleanupFluxionInstance() {
  await instanceManager.unregister();
}
