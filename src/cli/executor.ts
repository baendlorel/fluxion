import path from 'node:path';
import { FluxionCommand } from './types.js';
import { fluxion } from '@/fluxion.js';
import { getInstanceManager } from '@/cluster/launcher.js';

export function executor(command: FluxionCommand) {
  if (command.name === null) {
    let configPath = command.options.find((v) => v.option === 'config')?.value ?? 'fluxion.config.ts';
    configPath = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath);
    const config = require(configPath);
    fluxion(config.default);
  } else if (command.name === 'status') {
    // 显示当前运行的 fluxion 实例
    const manager = getInstanceManager();
    const instances = manager.getRunningInstances();
    console.log('Running Fluxion instances:');
    if (instances.length === 0) {
      console.log('  No instances running.');
    } else {
      for (const instance of instances) {
        console.log(`  - PID: ${instance.pid}`);
        console.log(`    Port: ${instance.port}`);
        console.log(`    Meta Port: ${instance.metaPort}`);
        console.log(`    Host: ${instance.host}`);
        console.log(`    Config Hash: ${instance.configHash.slice(0, 16)}...`);
        console.log(`    Started: ${new Date(instance.startTime).toISOString()}`);
        console.log(`    Working Dir: ${instance.cwd}`);
        console.log(`    Config Path: ${instance.configPath}`);
        console.log('');
      }
    }
  } else if (command.name === 'stop') {
    // 停止所有运行的 fluxion 实例
    const manager = getInstanceManager();
    const instances = manager.getRunningInstances();
    if (instances.length === 0) {
      console.log('No running instances to stop.');
      return;
    }
    console.log(`Stopping ${instances.length} instance(s)...`);
    for (const instance of instances) {
      try {
        process.kill(instance.pid, 'SIGTERM');
        console.log(`  - Stopped instance PID: ${instance.pid}`);
      } catch (error) {
        console.error(`  - Failed to stop instance PID: ${instance.pid}`, error);
      }
    }
    // 清理实例记录
    manager.unregisterInstance();
    console.log('All instances stopped.');
  } else if (command.name === 'logs') {
    // 显示日志（此功能暂未实现）
    console.log('Logs command is not yet implemented.');
  }
}
