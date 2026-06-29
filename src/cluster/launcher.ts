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

  constructor() {
    const dir = path.join(os.homedir(), '.fluxion');
    this.instanceFilePath = path.join(dir, 'instances.json');

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 读取实例记录
   * @returns 实例记录数组
   */
  read(liveOnly = false): FluxionInstanceRecord[] {
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

    return liveOnly
      ? result.filter((instance: FluxionInstanceRecord) => {
          try {
            // & 0 means only check, not kill
            process.kill(instance.pid, 0);
            return true;
          } catch {
            return false;
          }
        })
      : result;
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

  private kill(pid: number): boolean {
    try {
      process.kill(pid, 'SIGTERM');
      return true;
    } catch (error) {
      console.error(`[FluxionInstanceManager] Failed to kill process ${pid}:`, error);
      return false;
    }
  }

  register(configPath: string, host: string, port: number, metaPort: number): void {
    const currentPid = process.pid;
    const cwd = process.cwd();

    const duplicate = this.read(true).find((instance) => instance.configPath === configPath);
    if (duplicate) {
      console.warn(
        `[FluxionInstanceManager] Found existing instance with same config or port: PID=${duplicate.pid}, PORT=${duplicate.port}`,
      );

      if (this.kill(duplicate.pid)) {
        console.warn(`[FluxionInstanceManager] Killed old process ${duplicate.pid}`);
      }

      const instances = this.read();
      const filtered = instances.filter((instance) => instance.pid !== duplicate.pid);
      this.update(filtered);
    }

    const instances = this.read(true).filter((instance) => instance.pid !== currentPid);

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
    const currentPid = process.pid;
    const instances = this.read();
    const filtered = instances.filter((instance) => instance.pid !== currentPid);

    if (filtered.length !== instances.length) {
      this.update(filtered);
      console.info(`[FluxionInstanceManager] Unregistered instance: PID=${currentPid}`);
    }
  }

  print(): void {
    const instances = this.read();
    console.info('[FluxionInstanceManager] Current instances:');
    for (const instance of instances) {
      console.info(
        `  - PID: ${instance.pid}, PORT: ${instance.port}, PATH: ${instance.configPath}, START: ${new Date(instance.startTime).toISOString()}`,
      );
    }
  }
}

export const instanceManager: FluxionInstanceManager = new FluxionInstanceManager();
