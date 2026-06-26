import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 实例记录结构
 */
interface FluxionInstanceRecord {
  /** 启动时间戳 */
  startTime: number;
  /** 主进程 PID */
  pid: number;
  /** 配置文件 Hash 值 */
  configHash: string;
  /** 主机地址 */
  host: string;
  /** 端口号 */
  port: number;
  /** Meta API 端口号 */
  metaPort: number;
  /** 工作目录 */
  cwd: string;
  /** 配置文件路径 */
  configPath: string;
}

/**
 * 实例 JSON 文件结构
 */
interface InstanceJson {
  instances: FluxionInstanceRecord[];
}

/**
 * FLUXION 实例管理器
 * 用于防止重复启动相同配置的 fluxion 实例
 */
export class FluxionInstanceManager {
  private readonly instanceFilePath: string;
  private readonly homeDir: string;
  private readonly fluxionDir: string;

  constructor() {
    this.homeDir = os.homedir();
    this.fluxionDir = path.join(this.homeDir, '.fluxion');
    this.instanceFilePath = path.join(this.fluxionDir, 'instance.json');

    // 确保 .fluxion 目录存在
    this.ensureFluxionDir();
  }

  /**
   * 确保 .fluxion 目录存在
   */
  private ensureFluxionDir(): void {
    if (!fs.existsSync(this.fluxionDir)) {
      fs.mkdirSync(this.fluxionDir, { recursive: true });
    }
  }

  /**
   * 计算配置文件的 Hash 值
   * @param configPath 配置文件路径
   * @returns Hash 字符串
   */
  private calculateConfigHash(configPath: string): string {
    try {
      if (!fs.existsSync(configPath)) {
        return '';
      }
      const configContent = fs.readFileSync(configPath, 'utf-8');
      return crypto.createHash('sha256').update(configContent).digest('hex');
    } catch {
      return '';
    }
  }

  /**
   * 读取实例记录
   * @returns 实例记录数组
   */
  private readInstances(): FluxionInstanceRecord[] {
    try {
      if (!fs.existsSync(this.instanceFilePath)) {
        return [];
      }
      const content = fs.readFileSync(this.instanceFilePath, 'utf-8');
      const data: InstanceJson = JSON.parse(content);
      return data.instances || [];
    } catch {
      return [];
    }
  }

  /**
   * 写入实例记录
   * @param instances 实例记录数组
   */
  private writeInstances(instances: FluxionInstanceRecord[]): void {
    try {
      const data: InstanceJson = { instances };
      fs.writeFileSync(this.instanceFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to write instance.json:', error);
    }
  }

  /**
   * 清理已死亡的实例记录
   * @param instances 实例记录数组
   * @returns 清理后的实例记录数组
   */
  private cleanupDeadInstances(instances: FluxionInstanceRecord[]): FluxionInstanceRecord[] {
    return instances.filter((instance) => {
      try {
        // 检查进程是否存在
        process.kill(instance.pid, 0);
        return true;
      } catch {
        // 进程不存在，移除记录
        return false;
      }
    });
  }

  /**
   * 查找相同配置的运行实例
   * @param configHash 配置文件 Hash 值
   * @param port 端口号
   * @returns 找到的实例记录，如果没有则返回 null
   */
  private findDuplicateInstance(configHash: string, port: number): FluxionInstanceRecord | null {
    const instances = this.readInstances();
    const cleanedInstances = this.cleanupDeadInstances(instances);

    // 查找相同配置或相同端口的实例
    const duplicate = cleanedInstances.find(
      (instance) => instance.configHash === configHash || instance.port === port,
    );

    return duplicate || null;
  }

  /**
   * 终止进程
   * @param pid 进程 ID
   * @returns 是否成功终止
   */
  private killProcess(pid: number): boolean {
    try {
      process.kill(pid, 'SIGTERM');
      return true;
    } catch (error) {
      console.error(`Failed to kill process ${pid}:`, error);
      return false;
    }
  }

  /**
   * 注册当前实例
   * @param configPath 配置文件路径
   * @param host 主机地址
   * @param port 端口号
   * @param metaPort Meta API 端口号
   */
  registerInstance(configPath: string, host: string, port: number, metaPort: number): void {
    const configHash = this.calculateConfigHash(configPath);
    const currentPid = process.pid;
    const cwd = process.cwd();

    // 检查是否有重复配置的实例在运行
    const duplicate = this.findDuplicateInstance(configHash, port);
    if (duplicate) {
      console.warn(
        `[FluxionInstanceManager] Found existing instance with same config or port: PID=${duplicate.pid}, PORT=${duplicate.port}`,
      );

      // 尝试终止旧进程
      if (this.killProcess(duplicate.pid)) {
        console.warn(`[FluxionInstanceManager] Killed old process ${duplicate.pid}`);
      }

      // 移除旧实例记录
      const instances = this.readInstances();
      const filtered = instances.filter((instance) => instance.pid !== duplicate.pid);
      this.writeInstances(filtered);
    }

    // 读取现有实例记录，清理死亡实例
    let instances = this.readInstances();
    instances = this.cleanupDeadInstances(instances);

    // 移除当前 PID 的旧记录（如果存在）
    instances = instances.filter((instance) => instance.pid !== currentPid);

    // 添加新实例记录
    const newRecord: FluxionInstanceRecord = {
      startTime: Date.now(),
      pid: currentPid,
      configHash,
      host,
      port,
      metaPort,
      cwd,
      configPath,
    };
    instances.push(newRecord);

    // 写入文件
    this.writeInstances(instances);

    console.info(
      `[FluxionInstanceManager] Registered instance: PID=${currentPid}, PORT=${port}, HASH=${configHash.slice(0, 8)}...`,
    );
  }

  /**
   * 注销当前实例
   */
  unregisterInstance(): void {
    const currentPid = process.pid;
    const instances = this.readInstances();
    const filtered = instances.filter((instance) => instance.pid !== currentPid);

    if (filtered.length !== instances.length) {
      this.writeInstances(filtered);
      console.info(`[FluxionInstanceManager] Unregistered instance: PID=${currentPid}`);
    }
  }

  /**
   * 获取所有运行的实例
   * @returns 实例记录数组
   */
  getRunningInstances(): FluxionInstanceRecord[] {
    const instances = this.readInstances();
    return this.cleanupDeadInstances(instances);
  }

  /**
   * 打印实例信息（用于调试）
   */
  printInstances(): void {
    const instances = this.getRunningInstances();
    console.info('[FluxionInstanceManager] Current instances:');
    for (const instance of instances) {
      console.info(
        `  - PID: ${instance.pid}, PORT: ${instance.port}, HASH: ${instance.configHash.slice(0, 8)}..., START: ${new Date(instance.startTime).toISOString()}`,
      );
    }
  }
}

// 全局实例管理器
let instanceManager: FluxionInstanceManager | null = null;

/**
 * 获取全局实例管理器
 * @returns FluxionInstanceManager 实例
 */
export function getInstanceManager(): FluxionInstanceManager {
  if (!instanceManager) {
    instanceManager = new FluxionInstanceManager();
  }
  return instanceManager;
}

/**
 * 启动 fluxion 实例前的检查和注册
 * @param configPath 配置文件路径
 * @param host 主机地址
 * @param port 端口号
 * @param metaPort Meta API 端口号
 */
export function launchFluxionInstance(configPath: string, host: string, port: number, metaPort: number): void {
  const manager = getInstanceManager();
  manager.registerInstance(configPath, host, port, metaPort);
}

/**
 * 清理 fluxion 实例（在进程退出时调用）
 */
export function cleanupFluxionInstance(): void {
  const manager = getInstanceManager();
  manager.unregisterInstance();
}
