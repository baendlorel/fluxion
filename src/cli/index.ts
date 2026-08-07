#!/usr/bin/env node

/**
 * Fluxion CLI 入口
 *
 * 用法：
 *   fluxion start                 启动实例
 *   fluxion stop <uid>            停止实例
 *   fluxion restart <uid>         重启实例
 *   fluxion list                  列出所有实例
 *   fluxion init                  创建配置文件模板
 *   fluxion startup               安装 systemd 服务（开机自启）
 *   fluxion shutdown              停止 daemon 及所有实例
 */

import { start } from './commands/start.js';
import { stop } from './commands/stop.js';
import { restart } from './commands/restart.js';
import { list } from './commands/list.js';
import { init } from './commands/init.js';
import { startup } from './commands/startup.js';
import { shutdown } from './commands/shutdown.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case 'start':
      await start();
      break;

    case 'stop':
      await stop(args[1]);
      break;

    case 'restart':
      await restart(args[1]);
      break;

    case 'list':
      await list();
      break;

    case 'init':
      init();
      break;

    case 'startup':
      await startup();
      break;

    case 'shutdown':
      await shutdown();
      break;

    case '--help':
    case '-h':
      showHelp();
      break;

    case '--version':
    case '-v':
      showVersion();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "fluxion --help" for usage.');
      process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
Fluxion — 进程管理器

用法:
  fluxion start                 启动实例
  fluxion stop <uid>            停止实例
  fluxion restart <uid>         重启实例
  fluxion list                  列出所有实例
  fluxion init                  创建配置文件模板
  fluxion startup               安装 systemd 服务（开机自启）
  fluxion shutdown              停止 daemon 及所有实例
  fluxion --help, -h            显示帮助信息
  fluxion --version, -v         显示版本信息
`);
}

function showVersion(): void {
  // __VERSION__ is replaced at build time by the @rollup/plugin-replace
  const version: string = (typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0');
  console.log(`fluxion v${version}`);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});