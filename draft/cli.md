# Fluxion CLI 工具设计

类 PM2 的进程管理器，极简，只支持类 Unix 系统。

---

## 1. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                         CLI 层 (瞬态进程)                          │
│  fluxion start    →  spawn daemon (如未运行) + IPC 通知启动实例    │
│  fluxion stop     →  IPC 通知 daemon 停止某实例                    │
│  fluxion restart  →  IPC 通知 daemon 重启某实例                    │
│  fluxion list     →  IPC 向 daemon 查询实例列表                    │
│  fluxion init     →  直接在当前目录创建配置文件                     │
│  fluxion startup  →  生成 systemd 服务（开机自启 daemon）          │
│  fluxion shutdown →  IPC 通知 daemon 停止所有实例并退出            │
│                     │                                              │
│                     │ Unix Socket ( ~/.fluxion/daemon.sock )       │
│                     ▼                                              │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  PID 1（init）                                             │    │
│  │    └─ God Daemon (常驻, 孤儿进程被 init 收养)               │    │
│  │       - 父进程退出后变成孤儿 → init 收养                      │    │
│  │       - 监听 daemon.sock 处理 IPC 请求                       │    │
│  │       - 内存中维护实例 Map                                   │    │
│  │       - spawn 子进程, 监听 exit 事件, 自动重启                │    │
│  │       - 写 ~/.fluxion/instances/<uid>.json 持久化            │    │
│  │       │                                                     │    │
│  │       │ spawn(interpreter, [entry], { detached, cwd, env }) │    │
│  │       ▼                                                     │    │
│  │       ┌──────────────────────────────────────┐              │    │
│  │       │ 子进程实例 (用户代码)                   │              │    │
│  │       │ - 可以是 fluxion 服务器, 也可以是其他    │              │    │
│  │       │ - stdout/stderr → ~/.fluxion/logs/    │              │    │
│  │       └──────────────────────────────────────┘              │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 核心进程模型

**三种进程，生命周期各不相同：**

| 进程 | 生命周期 | 数量 | 父进程 |
|------|---------|------|--------|
| CLI 命令 | 瞬态（~100ms） | 每次命令一个 | 当前 shell |
| God Daemon | 常驻（直到 kill） | 永远 **1 个** | PID 1（init） |
| 子进程实例 | 常驻（崩溃则重启） | 0~N 个 | God Daemon |

### God Daemon 如何保持存在

```javascript
// daemon 启动方式 —— 关键三行
const child = spawn(process.execPath, [daemonScript], {
  detached: true,   // ① 脱离父进程的进程组，收不到 SIGHUP
  stdio: 'ignore',  // ② 不继承终端，避免管道破裂 EPIPE
});
child.unref();      // ③ 父进程不等子进程，立即退出
// → 父进程（CLI 命令）exit 后，子进程变成孤儿，被 init 收养
// → daemon 从此常驻后台，直到机器关机或 fluxion kill
```

---

## 2. IPC 通信协议

### 传输层

- **Unix Domain Socket**：`~/.fluxion/daemon.sock`
- 消息格式：**JSON over newline-delimited stream**（每行一个完整 JSON）

### 消息类型

```typescript
interface IpcMessage {
  id: string;            // 消息唯一 ID，用于请求-响应匹配
  type: 'req' | 'res';
  method: string;        // start | stop | restart | list | status | ping
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: string; message: string };
}
```

### 典型消息流

```
CLI (瞬态)                    God Daemon (常驻)
  │                              │
  │── connect daemon.sock ──────→│
  │                              │
  │── {id:"1",type:"req",        │  list 请求：cli 请求实例列表
  │    method:"list"} ──────────→│
  │                              │  daemon 从内存返回
  │←── {id:"1",type:"res",       │
  │    result:[{uid,pid,...}]} ──│
  │                              │
  │── disconnect ───────────────→│  cli 退出
  │                              │
  │                              │
  │── connect daemon.sock ──────→│  cli 再次执行
  │── {id:"2",type:"req",        │  start 请求：启动新实例
  │    method:"start",           │
  │    params:{config:{...}}} ──→│
  │                              │  daemon 检查 uid 是否重复
  │                              │  daemon spawn 子进程
  │←── {id:"2",type:"res",       │
  │    result:{uid,pid}} ───────→│
  │── disconnect ───────────────→│
```

### CLI 连接超时

CLI 发送请求后，设置 5 秒超时：
- 超时未收到响应 → 报错退出
- 收到响应 → 打印结果退出

---

## 3. 持久化目录结构

```
~/.fluxion/
├── daemon.pid              # God Daemon 的 PID
├── daemon.sock             # Unix Domain Socket（IPC 通信）
├── instances/              # 持久化实例信息
│   ├── a1b2c3d4e5f6.json   # 实例 uid 信息
│   ├── f6e5d4c3b2a1.json   # 实例 uid 信息
│   └── ...                 # uid.json
└── logs/
    ├── a1b2c3d4e5f6.log    # 实例 abc 的日志
    ├── f6e5d4c3b2a1.log    # 实例 xyz 的日志
    └── ...
```

### UID 计算

```typescript
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

function computeUid(cwd: string, entry: string): string {
  const hash = createHash('sha256');
  hash.update(resolve(cwd));          // 启动目录
  hash.update(resolve(cwd, entry));   // 入口文件
  return hash.digest('hex').slice(0, 12);
}
// 例: cwd="/home/user/project", entry="src/index.ts"
//   → "a1b2c3d4e5f6"
```

- 同一项目始终得到相同 uid → `start` 时检测是否已在运行
- 不同项目必然不同 uid → 不会冲突
- 无需自增 ID，无需全局计数器

### instances/<uid>.json 格式

```json
{
  "uid": "a1b2c3d4e5f6",
  "pid": 12345,
  "status": "online",
  "startTime": 1785142421990,
  "restartCount": 0,
  "maxRestarts": 3,
  "cwd": "/home/user/project",
  "entry": "src/index.ts",
  "interpreter": "tsx",
  "env": {}
}
```

- `status`：`online` | `stopped` | `errored`
- daemon 每次启动/停止/异常都更新对应文件
- daemon 重启时读取所有 `instances/*.json`，复活 status 为 online 的实例
- `list` 命令通过 IPC 向 daemon 查询（daemon 从内存返回，更快）

---

## 4. CLI 命令

### 4.1 `fluxion start`

```
fluxion start

行为：
  1. 检查 ~/.fluxion/daemon.pid 是否存在且进程存活
     - 如果 daemon 不在运行 → 启动 God Daemon（detached + unref）
     - 等待 daemon.sock 创建（最多 3s）
  2. 在当前目录查找 .fluxion.config.js 或 .fluxion.config.ts（按顺序，只取一个）
  3. 读取并解析配置文件，得到 NormalizedFluxionInstanceOptions
  4. 用 cwd + entry 计算 uid
  5. 通过 daemon.sock 发送 IPC 消息 { method: "start", params: { config } }
  6. daemon 检查 uid 是否已存在且 status=online → 是则返回已运行
  7. daemon spawn 子进程
  8. daemon 写 instances/<uid>.json
  9. daemon 返回 { uid, pid }
  10. CLI 输出：Started a1b2c3d4e5f6 (pid 12345)
```

### 4.2 `fluxion stop <uid>`

```
fluxion stop <uid>

行为：
  1. 通过 daemon.sock 发送 { method: "stop", params: { uid } }
  2. daemon 向实例进程发送 SIGTERM
  3. 等待进程退出（最多 5s），超时则 SIGKILL
  4. daemon 更新 instances/<uid>.json 的 status 为 "stopped"
  5. daemon 返回结果
  6. CLI 输出：Stopped a1b2c3d4e5f6
```

### 4.3 `fluxion restart <uid>`

```
fluxion restart <uid>

行为：
  1. 通过 daemon.sock 发送 { method: "restart", params: { uid } }
  2. daemon 执行 stop 逻辑
  3. daemon 用原配置重新 spawn 子进程
  4. daemon 更新 instances/<uid>.json
  5. daemon 返回 { uid, pid }
  6. CLI 输出：Restarted a1b2c3d4e5f6 (pid 12346)
```

### 4.4 `fluxion list`

```
fluxion list

行为：
  1. 通过 daemon.sock 发送 { method: "list" }
  2. daemon 从内存返回所有实例信息
  3. 输出表格：

UID          Status   Pid    Entry                Uptime    Restarts
a1b2c3d4e5f6 online   12345  src/index.ts         2h 15m    0
f6e5d4c3b2a1 online   12346  src/api.ts           5h 30m    1
b0d1e2f3a4b5 stopped  -      src/worker.ts        -         0
```

### 4.5 `fluxion init`

```
fluxion init

行为：
  1. 在当前目录创建 .fluxion.config.ts 文件
  2. 内容是一个模板，包含 defineFluxionInstance 调用
```

### 4.6 `fluxion startup`

```
fluxion startup

行为：
  1. 检测当前的 init 系统（目前只支持 systemd）
  2. 检查是否有 root 权限（写 /etc/systemd/system/ 需要 sudo）
  3. 生成 fluxion-daemon.service 文件
  4. 写入 /etc/systemd/system/fluxion-daemon.service
  5. 执行 systemctl daemon-reload
  6. 执行 systemctl enable fluxion-daemon
  7. 输出提示：Service installed. Fluxion daemon will start on boot.
```

### 4.7 `fluxion shutdown`

```
fluxion shutdown

行为：
  1. 通过 daemon.sock 发送 { method: "shutdown" }
  2. daemon 向所有子进程发送 SIGTERM（等待 5s，超时 SIGKILL）
  3. daemon 删除 daemon.sock 和 daemon.pid
  4. daemon 退出
  5. CLI 输出：Fluxion daemon stopped
```

---

## 6. 构建系统服务（systemd）

### 6.1 做了什么

`fluxion startup` 做的事情和 `pm2 startup` 完全一样——生成一个 systemd unit 文件，注册到 systemd，让 fluxion daemon 随机器开机自启。

### 6.2 生成的 systemd service 文件

```ini
# /etc/systemd/system/fluxion-daemon.service
[Unit]
Description=Fluxion process manager
Documentation=https://github.com/baendlorel/fluxion
After=network.target

[Service]
Type=simple
User=%USER%
Environment=FLUXION_HOME=%USER_HOME%/.fluxion
ExecStart=%NODE_PATH% %FLUXION_DAEMON_SCRIPT%
ExecStop=%FLUXION_HOME%/bin/fluxion shutdown
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

**关键点**：
- `Type=simple` — 因为 daemon 本身就是一个常驻进程，不需要 fork 两次
- `ExecStart` — 直接用 node 执行 daemon 脚本
- `Restart=on-failure` — systemd 会在 daemon 崩溃时自动重启它（这是第二层守护：systemd 守护 daemon，daemon 守护子进程）
- `RestartSec=3` — 崩溃后等 3 秒再重启

### 6.3 与 detached 方式的关系

fluxion daemon 有两种启动方式：

| 启动方式 | 触发场景 | 父进程 | 守护者 |
|---------|---------|-------|--------|
| `detached + unref`（孤儿进程） | 用户 `fluxion start` 时 daemon 未运行 | init（PID 1） | 无（靠自身稳定） |
| systemd service | 机器开机时 | systemd | systemd（崩溃自动重启） |

**两者互不冲突**：
- 用户 `fluxion start` 时如果 daemon 没跑 → detached 方式启动（临时）
- 安装了 systemd 服务后 → systemd 管理 daemon 生命周期
- `fluxion shutdown` 无论哪种方式都能停止 daemon
- 机器重启后，systemd 自动拉起 daemon，daemon 复活所有子进程

### 6.4 `fluxion startup` 命令实现

```typescript
// src/cli/commands/startup.ts
import { writeFileSync, chmodSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const SYSTEMD_SERVICE_PATH = '/etc/systemd/system/fluxion-daemon.service';

function generateSystemdService(): string {
  const user = process.env.USER || 'root';
  const home = homedir();
  const nodePath = process.execPath;
  const daemonScript = resolve(__dirname, '../daemon.js');

  return `[Unit]
Description=Fluxion process manager
Documentation=https://github.com/baendlorel/fluxion
After=network.target

[Service]
Type=simple
User=${user}
Environment=FLUXION_HOME=${home}/.fluxion
ExecStart=${nodePath} ${daemonScript}
ExecStop=${nodePath} ${daemonScript} shutdown
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
`;
}

export async function startup() {
  // 检查是否 systemd
  try {
    execSync('which systemctl', { stdio: 'ignore' });
  } catch {
    console.error('systemd not found. This command only supports systemd.');
    process.exit(1);
  }

  // 生成 service 文件内容
  const content = generateSystemdService();

  // 写入（需要 sudo）
  try {
    writeFileSync(SYSTEMD_SERVICE_PATH, content);
    chmodSync(SYSTEMD_SERVICE_PATH, 0o644);
  } catch {
    // 权限不足，提示用户用 sudo
    console.log('Need root permission. Run:');
    console.log();
    console.log(`  sudo fluxion startup`);
    console.log();
    console.log('Or manually install:');
    console.log(`  sudo cat > ${SYSTEMD_SERVICE_PATH} << 'EOF'`);
    console.log(content);
    console.log('EOF');
    console.log(`  sudo systemctl daemon-reload`);
    console.log(`  sudo systemctl enable fluxion-daemon`);
    process.exit(1);
  }

  // 注册并启动
  execSync('systemctl daemon-reload', { stdio: 'inherit' });
  execSync('systemctl enable fluxion-daemon', { stdio: 'inherit' });
  execSync('systemctl start fluxion-daemon', { stdio: 'inherit' });

  console.log('✓ Fluxion daemon service installed and started.');
  console.log('  It will automatically start on boot.');
}
```

### 6.5 进程守护层级

```
systemd
  └─ fluxion-daemon.service (God Daemon)
       │  systemd 守护 daemon（崩溃自动重启）
       │  Restart=on-failure + RestartSec=3
       │
       ├─ 子进程实例 A
       │    daemon 守护子进程（exit 事件触发重启）
       │    maxRestarts=3, 指数退避
       │
       └─ 子进程实例 B
            同理
```

**三层守护**：
1. **systemd → daemon**：daemon 崩溃时 systemd 自动拉起（3 秒后重试）
2. **daemon → 子进程**：子进程退出时 daemon 自动重启（指数退避，最多 3 次）
3. **daemon 自身复活机制**：daemon 启动时读 `instances/*.json`，复活所有 `online` 状态的实例

### 6.6 卸载 systemd 服务

```bash
# 手动卸载
sudo systemctl stop fluxion-daemon
sudo systemctl disable fluxion-daemon
sudo rm /etc/systemd/system/fluxion-daemon.service
sudo systemctl daemon-reload
```

（也可以考虑加一个 `fluxion unstartup` 命令，但初期没必要）

---

## 7. 配置文件

### 文件位置

- 在当前目录查找 `.fluxion.config.js` 或 `.fluxion.config.ts`（按顺序，有谁取谁）
- 不会同时读两个

### defineFluxionInstance

```typescript
// src/defines/fluxion-instance.ts
import { resolve } from 'node:path';

export interface FluxionInstanceOptions {
  /** 解析器，如 tsx、node 等。默认 node */
  interpreter?: string;
  /** 工作目录，默认 process.cwd() */
  cwd?: string;
  /** 入口文件，会被 interpreter 执行 */
  entry: string;
  /** 最大重启次数，默认 3 */
  maxRestarts?: number;
  /** 环境变量，默认 process.env */
  env?: Record<string, string | undefined>;
}

export interface NormalizedFluxionInstanceOptions {
  interpreter: string;
  cwd: string;
  entry: string;
  maxRestarts: number;
  env: Record<string, string | undefined>;
}

export function defineFluxionInstance(o: FluxionInstanceOptions): NormalizedFluxionInstanceOptions {
  return {
    interpreter: o.interpreter ?? 'node',
    cwd: resolve(o.cwd ?? process.cwd()),
    entry: o.entry,
    maxRestarts: o.maxRestarts ?? 3,
    env: o.env ?? { ...process.env },
  };
}
```

### 配置文件模板

```typescript
// .fluxion.config.ts
import { defineFluxionInstance } from 'fluxion';

export default defineFluxionInstance({
  interpreter: 'tsx',
  entry: 'src/index.ts',
  maxRestarts: 3,
});
```

### 执行方式

```
daemon 收到 start 请求后：
  const command = config.interpreter;  // "tsx" | "node" | ...
  const args = [config.entry];         // "src/index.ts"
  const options = { cwd: config.cwd, env: config.env };

  spawn(command, args, options);
```

---

## 6. God Daemon 设计

### 6.1 Daemon 启动（由 CLI 触发）

```typescript
// src/cli/daemon.ts
// 这个文件本身会被 spawn 成为 daemon

import { createServer } from 'node:net';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const FLUXION_HOME = resolve(homedir(), '.fluxion');
const SOCKET_PATH = resolve(FLUXION_HOME, 'daemon.sock');
const PID_PATH = resolve(FLUXION_HOME, 'daemon.pid');
const INSTANCES_DIR = resolve(FLUXION_HOME, 'instances');
const LOGS_DIR = resolve(FLUXION_HOME, 'logs');

// 确保目录存在
mkdirSync(INSTANCES_DIR, { recursive: true });
mkdirSync(LOGS_DIR, { recursive: true });

// 写 PID 文件
writeFileSync(PID_PATH, String(process.pid));

// 内存中的实例 Map
const instances = new Map<string, ManagedInstance>();

// 启动时复活之前的实例
function resurrect() {
  const files = readdirSync(INSTANCES_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const data = JSON.parse(readFileSync(resolve(INSTANCES_DIR, file), 'utf-8'));
    if (data.status === 'online') {
      // 检查进程是否还活着，如果死了则重新 spawn
      if (!isPidAlive(data.pid)) {
        spawnInstance(data); // 用保存的配置重新启动
      }
    }
  }
}
```

### 6.2 Daemon 启动方式（由 CLI 触发）

```typescript
// 这段代码在 CLI 命令中（如 fluxion start 的开头）
function ensureDaemonRunning(): Promise<void> {
  // 检查 daemon 是否在运行
  if (existsSync(PID_PATH)) {
    const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
    if (isPidAlive(pid)) return Promise.resolve(); // daemon 已在运行
  }

  // 启动 God Daemon —— 关键三行
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [daemonScript], {
      detached: true,   // ① 脱离父进程的进程组
      stdio: 'ignore',  // ② 不继承终端 stdio
    });
    child.unref();      // ③ 父进程不等子进程

    // 等待 socket 文件出现（最多 3 秒）
    waitForSocket(3000).then(resolve).catch(reject);
  });
}
```

### 6.3 Unix Socket IPC 服务器

```typescript
// daemon 中的 IPC 服务器
const server = createServer((socket) => {
  let buffer = '';

  socket.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        handleMessage(msg, socket);
      } catch (e) {
        // 忽略无效 JSON
      }
    }
  });

  socket.on('close', () => { /* 清理 */ });
});

server.listen(SOCKET_PATH, () => {
  // 确保只有当前用户能读写
  chmodSync(SOCKET_PATH, 0o600);
});
```

### 6.4 IPC 消息处理

```typescript
interface IpcMessage {
  id: string;
  type: 'req' | 'res';
  method: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: string; message: string };
}

function handleMessage(msg: IpcMessage, socket: net.Socket) {
  switch (msg.method) {
    case 'start':   return handleStart(msg, socket);
    case 'stop':    return handleStop(msg, socket);
    case 'restart': return handleRestart(msg, socket);
    case 'list':    return handleList(msg, socket);
    case 'ping':    return sendResponse(msg, socket, { ok: true });
    default:
      sendResponse(msg, socket, null, { code: 'UNKNOWN_METHOD', message: `Unknown method: ${msg.method}` });
  }
}
```

### 6.5 子进程管理

```typescript
interface ManagedInstance {
  uid: string;
  pid: number;
  process: ChildProcess;
  config: NormalizedFluxionInstanceOptions;
  status: 'online' | 'stopped' | 'errored';
  startTime: number;
  restartCount: number;
  logFile?: fs.WriteStream;
}

function spawnInstance(config: NormalizedFluxionInstanceOptions): string {
  const uid = computeUid(config.cwd, config.entry);

  // 检查是否已运行
  const existing = instances.get(uid);
  if (existing && existing.status === 'online' && isPidAlive(existing.pid)) {
    throw new Error(`Instance already running: ${uid}`);
  }

  // 创建日志流
  const logFile = fs.createWriteStream(resolve(LOGS_DIR, `${uid}.log`), { flags: 'a' });

  // spawn 子进程
  const child = spawn(config.interpreter, [config.entry], {
    cwd: config.cwd,
    env: config.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(logFile);
  child.stderr.pipe(logFile);

  const instance: ManagedInstance = {
    uid,
    pid: child.pid!,
    process: child,
    config,
    status: 'online',
    startTime: Date.now(),
    restartCount: existing?.restartCount ?? 0,
    logFile,
  };

  instances.set(uid, instance);
  writeInstanceFile(uid, instance);

  // 监听 exit → 自动重启
  child.on('exit', (code, signal) => {
    instance.status = 'stopped';
    instance.logFile?.end();
    writeInstanceFile(uid, instance);

    if (instance.restartCount < config.maxRestarts) {
      instance.restartCount++;
      // 重新 spawn
      spawnInstance(config);
    }
  });

  return uid;
}
```

### 6.6 Daemon 优雅退出

```typescript
// daemon 收到 SIGTERM/SIGINT → 保存状态 → 退出
process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());

function shutdown() {
  // 保存所有实例状态到文件（已经实时写了，不需要额外操作）
  // 断开 socket
  server.close();
  // 删除 socket 文件
  try { unlinkSync(SOCKET_PATH); } catch {}
  try { unlinkSync(PID_PATH); } catch {}
  // 不杀子进程 —— 再次 resurrect 时会接管
  process.exit(0);
}
```

---

## 7. 目录结构（src/cli/）

```
src/cli/
├── index.ts                  # CLI 入口，解析 argv，分发命令
├── daemon.ts                 # God Daemon 主进程（被 spawn 的常驻进程）
├── commands/
│   ├── start.ts              # 启动实例
│   ├── stop.ts               # 停止实例
│   ├── restart.ts            # 重启实例
│   ├── list.ts               # 列表
│   ├── init.ts               # 生成配置文件模板
│   ├── startup.ts            # 生成 systemd 服务
│   └── shutdown.ts           # 停止 daemon 及所有实例
├── shared/
│   ├── ipc.ts                # IPC 客户端/服务端
│   ├── store.ts              # ~/.fluxion/ 读写
│   ├── uid.ts                # UID 计算
│   └── types.ts              # 类型定义
└── defines/
    └── fluxion-instance.ts   # defineFluxionInstance
```

---

## 8. 与现有代码的关系

- `defineFluxionInstance` 是新增的，独立于现有的 `defineFluxionOptions`
- Daemon 管理的子进程是用户自己的入口文件（`entry`），不直接调用 `fluxion()` 函数
- 用户在自己的 `entry` 里可以使用 `fluxion()` 启动服务器，也可以做其他事情
- CLI 层是新增的，不侵入现有 `src/fluxion.ts`、`src/router/` 等核心代码
- `fluxion` 命令本身就是 `package.json` 的 `bin` 字段，指向 `src/cli/index.ts`

---

## 9. 实现路线

1. `defineFluxionInstance` 类型定义 + `uid.ts`
2. `store.ts` — `~/.fluxion/` 读写
3. `daemon.ts` — God Daemon（detached + unref + Socket IPC + 复活机制）
4. CLI 命令：`start` / `stop` / `restart` / `list` / `init` / `shutdown`
5. `fluxion init` 模板文件
6. `startup.ts` — 生成 systemd 服务（`fluxion startup`）