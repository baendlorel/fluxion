# Fluxion CLI 进程守护设计方案（精简版）

基于 PM2 原理为 fluxion CLI 提供基础的系统级进程管理。

## 核心原理

### 架构设计

```
┌──────────────┐
│ CLI 命令      │
└──────┬───────┘
       │ Unix Socket
┌──────▼───────┐
│ Daemon       │ ← 守护进程
└──────┬───────┘
       │ child_process
┌──────▼───────┐
│ App 进程     │ ← fluxion 服务
└──────────────┘
```

**职责分离**：
- **CLI**：一次性命令，连接 daemon 发送指令
- **Daemon**：常驻后台，管理 app 进程
- **App**：运行实际的 fluxion 服务

## 核心功能

### 1. 进程守护

```typescript
// 最基础的守护逻辑
class Daemon {
  private appProcess: ChildProcess | null = null;
  private restartCount = 0;
  private maxRestarts = 5; // 防止无限重启
  
  start() {
    this.spawnApp();
    this.watchApp();
  }
  
  private spawnApp() {
    this.appProcess = spawn('node', ['--import', 'tsx', 'dist/cli.mjs', '__app', 
      '--config', this.configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });
    
    // 重定向输出到日志文件
    this.redirectOutput();
    
    // 监听退出事件
    this.appProcess.on('exit', () => {
      this.handleExit();
    });
  }
  
  private handleExit() {
    if (this.restartCount < this.maxRestarts) {
      this.restartCount++;
      setTimeout(() => this.spawnApp(), 1000); // 延迟1秒重启
    } else {
      console.log('App crashed too many times, giving up');
      this.cleanup();
    }
  }
  
  private redirectOutput() {
    const outLog = fs.createWriteStream('.fluxion/app.out.log', { flags: 'a' });
    const errLog = fs.createWriteStream('.fluxion/app.err.log', { flags: 'a' });
    
    this.appProcess!.stdout?.pipe(outLog);
    this.appProcess!.stderr?.pipe(errLog);
  }
}
```

### 2. 心跳监控

```typescript
class Daemon {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastPong = 0;
  
  start() {
    // ... 启动 app
    this.startHeartbeat();
  }
  
  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeat();
    }, 5000); // 每5秒检查一次
  }
  
  private checkHeartbeat() {
    if (!this.appProcess) return;
    
    // 发送 ping
    this.appProcess.send?.({ type: 'ping' });
    
    // 检查是否超时（30秒无响应）
    if (Date.now() - this.lastPong > 30000) {
      this.handleTimeout();
    }
  }
  
  private handleTimeout() {
    // app 卡死，杀掉重启
    this.appProcess?.kill('SIGKILL');
    // exit 事件会触发自动重启
  }
}
```

### 3. Socket 服务器

```typescript
import { createServer } from 'node:net';
import { unlinkSync } from 'node:fs';

class DaemonServer {
  private socketPath = '.fluxion/daemon.sock';
  
  start() {
    // 清理旧的 socket 文件
    try {
      unlinkSync(this.socketPath);
    } catch {}
    
    const server = createServer((socket) => {
      let data = '';
      
      socket.on('data', (chunk) => {
        data += chunk.toString();
      });
      
      socket.on('end', () => {
        const request = JSON.parse(data);
        const response = this.handleRequest(request);
        socket.write(JSON.stringify(response));
        socket.end();
      });
    });
    
    server.listen(this.socketPath);
  }
  
  private handleRequest(request: any) {
    switch (request.type) {
      case 'start':
        return { ok: this.daemon.start() };
      case 'stop':
        return { ok: this.daemon.stop() };
      case 'status':
        return { ok: true, state: this.daemon.getState() };
      case 'logs':
        return { ok: true, logs: this.daemon.getLogs() };
      default:
        return { ok: false, error: 'Unknown command' };
    }
  }
}
```

### 4. App 侧改造

```typescript
// src/cli/index.ts
function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('__daemon')) {
    // 守护模式
    return startDaemon();
  }
  
  if (args.includes('__app')) {
    // App 模式：运行服务
    const configPath = getConfigPath(args);
    const config = require(configPath);
    fluxion(config.default);
    
    // 设置心跳响应
    setupHeartbeat();
    return;
  }
  
  // CLI 模式：执行命令
  executor(parseCommand());
}

function setupHeartbeat() {
  process.on('message', (msg: any) => {
    if (msg.type === 'ping') {
      process.send?.({ type: 'pong', at: Date.now() });
    }
  });
}
```

## CLI 命令接口

### 启动（后台）
```bash
fluxion --config fluxion.config.ts --daemon
```

### 停止
```bash
fluxion stop
```

### 查看状态
```bash
fluxion status
```

### 查看日志
```bash
fluxion logs
```

## 运行时文件

```
.fluxion/
├── daemon.sock       # Socket 文件
├── daemon.pid        # Daemon 进程 PID
├── app.pid           # App 进程 PID
├── app.out.log       # App 标准输出
└── app.err.log       # App 错误输出
```

## 实现步骤

### 第一步：创建守护进程模块

创建 `src/cli/daemon.ts`：

```typescript
import { spawn, ChildProcess } from 'child_process';
import { createServer, Server } from 'net';
import fs from 'fs';
import path from 'path';

export class Daemon {
  private appProcess: ChildProcess | null = null;
  private server: Server;
  private restartCount = 0;
  private lastPong = Date.now();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private configPath: string;
  
  // 运行时路径
  private runtimeDir = '.fluxion';
  private socketPath = path.join(this.runtimeDir, 'daemon.sock');
  private daemonPidPath = path.join(this.runtimeDir, 'daemon.pid');
  private appPidPath = path.join(this.runtimeDir, 'app.pid');
  private outLogPath = path.join(this.runtimeDir, 'app.out.log');
  private errLogPath = path.join(this.runtimeDir, 'app.err.log');
  
  constructor(configPath: string) {
    this.configPath = path.resolve(configPath);
    
    // 确保运行时目录存在
    if (!fs.existsSync(this.runtimeDir)) {
      fs.mkdirSync(this.runtimeDir, { recursive: true });
    }
    
    // 保存 daemon pid
    fs.writeFileSync(this.daemonPidPath, process.pid.toString());
    
    // 启动 socket 服务器
    this.server = this.createServer();
  }
  
  start() {
    this.spawnApp();
    this.startHeartbeat();
  }
  
  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    if (this.appProcess) {
      this.appProcess.kill('SIGTERM');
    }
    
    this.server.close();
    this.cleanup();
  }
  
  private spawnApp() {
    const args = [
      '--import', 'tsx',
      'dist/cli.mjs',
      '__app',
      '--config', this.configPath
    ];
    
    this.appProcess = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      cwd: process.cwd()
    });
    
    // 保存 app pid
    fs.writeFileSync(this.appPidPath, this.appProcess.pid.toString());
    
    // 重定向输出
    this.redirectOutput();
    
    // 监听退出
    this.appProcess.on('exit', (code) => {
      console.log(`App exited with code: ${code}`);
      this.handleExit();
    });
    
    // 监听 pong 响应
    this.appProcess.on('message', (msg: any) => {
      if (msg.type === 'pong') {
        this.lastPong = msg.at || Date.now();
      }
    });
  }
  
  private redirectOutput() {
    const outLog = fs.createWriteStream(this.outLogPath, { flags: 'a' });
    const errLog = fs.createWriteStream(this.errLogPath, { flags: 'a' });
    
    this.appProcess!.stdout?.pipe(outLog);
    this.appProcess!.stderr?.pipe(errLog);
  }
  
  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeat();
    }, 5000);
  }
  
  private checkHeartbeat() {
    if (!this.appProcess) return;
    
    // 发送 ping
    this.appProcess.send?.({ type: 'ping' });
    
    // 检查超时
    if (Date.now() - this.lastPong > 30000) {
      console.log('App timeout, killing...');
      this.appProcess.kill('SIGKILL');
    }
  }
  
  private handleExit() {
    if (this.restartCount < 5) {
      this.restartCount++;
      console.log(`Restarting app (attempt ${this.restartCount})...`);
      setTimeout(() => this.spawnApp(), 1000);
    } else {
      console.log('App crashed too many times, stopping');
      this.stop();
    }
  }
  
  private createServer(): Server {
    // 清理旧的 socket
    try {
      fs.unlinkSync(this.socketPath);
    } catch {}
    
    const server = createServer((socket) => {
      let data = '';
      
      socket.on('data', (chunk) => {
        data += chunk.toString();
      });
      
      socket.on('end', () => {
        try {
          const request = JSON.parse(data);
          const response = this.handleRequest(request);
          socket.write(JSON.stringify(response));
        } catch (err) {
          socket.write(JSON.stringify({ ok: false, error: String(err) }));
        }
        socket.end();
      });
    });
    
    server.listen(this.socketPath);
    return server;
  }
  
  private handleRequest(request: any) {
    switch (request.type) {
      case 'start':
        return { ok: true };
      case 'stop':
        this.stop();
        return { ok: true };
      case 'status':
        return {
          ok: true,
          state: {
            running: this.appProcess !== null,
            appPid: this.appProcess?.pid || null,
            daemonPid: process.pid,
            lastPong: this.lastPong,
            restartCount: this.restartCount
          }
        };
      case 'logs':
        return {
          ok: true,
          logs: {
            out: this.tailLog(this.outLogPath, 50),
            err: this.tailLog(this.errLogPath, 50)
          }
        };
      default:
        return { ok: false, error: 'Unknown command' };
    }
  }
  
  private tailLog(filePath: string, lines: number): string {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const allLines = content.split('\n');
      return allLines.slice(-lines).join('\n');
    } catch {
      return '';
    }
  }
  
  private cleanup() {
    try {
      fs.unlinkSync(this.socketPath);
      fs.unlinkSync(this.daemonPidPath);
      fs.unlinkSync(this.appPidPath);
    } catch {}
  }
  
  getState() {
    return {
      running: this.appProcess !== null,
      appPid: this.appProcess?.pid || null,
      daemonPid: process.pid,
      lastPong: this.lastPong,
      restartCount: this.restartCount
    };
  }
  
  getLogs() {
    return {
      out: this.tailLog(this.outLogPath, 50),
      err: this.tailLog(this.errLogPath, 50)
    };
  }
}

export function startDaemon(configPath: string) {
  const daemon = new Daemon(configPath);
  daemon.start();
  
  // 保持进程运行
  process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down...');
    daemon.stop();
    process.exit(0);
  });
  
  // 防止进程退出
  process.stdin.resume();
}
```

### 第二步：修改 CLI 入口

修改 `src/cli/index.ts`：

```typescript
import { startDaemon } from './daemon.js';

function main() {
  const args = process.argv.slice(2);
  
  // 守护模式
  if (args.includes('--daemon')) {
    const configPath = getConfigPath(args);
    return startDaemon(configPath);
  }
  
  // App 模式
  if (args.includes('__app')) {
    const configPath = getConfigPath(args);
    const config = require(configPath);
    fluxion(config.default);
    
    // 设置心跳响应
    process.on('message', (msg: any) => {
      if (msg.type === 'ping') {
        process.send?.({ type: 'pong', at: Date.now() });
      }
    });
    
    return;
  }
  
  // CLI 模式
  const command = parseCommand();
  executor(command);
}

function getConfigPath(args: string[]): string {
  const configIndex = args.indexOf('--config');
  return configIndex !== -1 ? args[configIndex + 1] : 'fluxion.config.ts';
}
```

### 第三步：实现 CLI 命令

修改 `src/cli/executor.ts`：

```typescript
import { connect } from 'node:net';
import path from 'path';

export function executor(command: FluxionCommand) {
  if (command.name === 'stop') {
    return sendToDaemon({ type: 'stop' });
  }
  
  if (command.name === 'status') {
    const response = sendToDaemon({ type: 'status' });
    if (response.ok) {
      printStatus(response.state);
    }
    return;
  }
  
  if (command.name === 'logs') {
    const response = sendToDaemon({ type: 'logs' });
    if (response.ok) {
      printLogs(response.logs);
    }
    return;
  }
  
  // 默认：运行服务
  if (command.name === null) {
    const configPath = getConfigPath(command.options);
    const response = sendToDaemon({ type: 'start', config: configPath });
    
    if (response.ok) {
      console.log('Fluxion started in daemon mode');
      console.log('Use "fluxion status" to check status');
      console.log('Use "fluxion stop" to stop');
    } else {
      console.error('Failed to start:', response.error);
    }
  }
}

function sendToDaemon(request: any): any {
  const socketPath = path.join(process.cwd(), '.fluxion', 'daemon.sock');
  
  return new Promise((resolve, reject) => {
    const client = connect({ path: socketPath });
    
    let response = '';
    client.on('data', (data) => {
      response += data.toString();
    });
    
    client.on('end', () => {
      try {
        resolve(JSON.parse(response));
      } catch (err) {
        reject(err);
      }
    });
    
    client.on('error', (err: any) => {
      if (err.code === 'ENOENT') {
        reject(new Error('Daemon not running. Start with --daemon first'));
      } else {
        reject(err);
      }
    });
    
    client.write(JSON.stringify(request));
    client.end();
  });
}
```

## 使用示例

```bash
# 启动守护模式
fluxion --config fluxion.config.ts --daemon

# 查看状态
fluxion status

# 查看日志
fluxion logs

# 停止服务
fluxion stop
```

## 关键参数（硬编码）

- 心跳间隔：5 秒
- 心跳超时：30 秒
- 最大重启次数：5 次
- 重启延迟：1 秒
- 日志行数：50 行

这些参数都是硬编码的，无需配置，保持简单。

## 总结

这个精简版本只保留了最核心的功能：

1. ✅ 守护进程 + app 进程的双层架构
2. ✅ Unix Socket 通信
3. ✅ 进程崩溃自动重启（带重试次数限制）
4. ✅ 心跳监控防止进程卡死
5. ✅ 基本的 start/stop/status/logs 命令
6. ✅ 简单的日志重定向

去掉了所有非必须的复杂功能，实现起来更加简单直接。
