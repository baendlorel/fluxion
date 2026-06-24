# Fluxion CLI 与守护进程方案

## 目标

1. 提供命令行入口：

   ```bash
   fluxion --config xx.config.ts
   ```

   CLI 读取 `xx.config.ts` 导出的 `config` 对象，然后执行：

   ```ts
   fluxion(config);
   ```

   配置文件必须按 `tsx` 环境加载，支持 TypeScript、ESM、路径别名按用户项目运行时解析。

2. 提供类似 pm2 的守护能力：
   - 当前 primary 已经能守护 **worker**：worker 崩溃、资源超限、健康检查超时后自动重启。
   - 当前 primary 还不能守护 **primary 自身**：primary 崩溃、宿主退出、手动关闭 shell 后不会自动拉起。
   - 因此需要新增一个 CLI 层的 supervisor，负责拉起并守护 primary 进程。

## 当前能力判断

### primary 已经能做到的

`src/cluster/primary.ts` 当前已经具备 worker 级别的自愈能力：

- primary 根据 `workerOptions.maxWorkerCount` fork 多个 worker。
- worker 意外退出后，primary 会按原 slot 重新 `spawnSlot`。
- `restartWhen.memoryUsageGreaterThan` 可触发内存超限回收。
- `restartWhen.healthzTimeout` 可触发健康检查超时回收。
- `restartWhen.uptimeGreaterThan` 可触发定时轮转。
- 有 `RESTART_WINDOW_MS` + `MAX_RESTARTS_PER_WINDOW` 防止 fork storm。

结论：**primary 是 worker supervisor，不是整套应用的 daemon manager。**

### primary 不能做到的

primary 本身仍然是前台进程：

- primary 崩溃后没有更外层进程负责重启。
- shell 关闭、SSH 断开、容器主进程结束时，不具备 pm2 那种后台驻留能力。
- 没有 pid 文件、日志文件、stop/restart/status 等管理命令。
- 没有将应用进程 detach 到独立 session。

结论：如果目标是“像 pm2 一样”，需要在 CLI 层新增 supervisor；不要把这部分塞进 primary，避免 primary 同时承担 worker 管理和自身管理两层职责。

## 推荐命令形态

### 最小启动

```bash
fluxion --config fluxion.config.ts
```

等价于：

```ts
import { config } from './fluxion.config.ts';
import { fluxion } from 'fluxion-ts';

fluxion(config);
```

默认行为：前台运行，不 daemonize。适合本地开发、容器、systemd、外部 pm2 托管。

### 守护启动

```bash
fluxion --config fluxion.config.ts --daemon
```

行为：

- 当前 CLI 进程成为短生命周期控制进程。
- 控制进程 fork/spawn 一个 detached supervisor。
- supervisor 再启动真正的 app 进程。
- app 进程内执行 `fluxion(config)`，之后由现有 primary 管理 workers。

进程关系：

```text
user shell
  └─ fluxion --daemon                 短生命周期 CLI
      └─ fluxion supervisor           detached，守护 app/primary
          └─ fluxion app              primary 进程，执行 fluxion(config)
              ├─ worker 1
              ├─ worker 2
              └─ worker N
```

守护职责分层：

```text
supervisor：守护 app/primary
primary：守护 workers
worker：实际 HTTP 服务与动态路由
```

## 配置文件规范

对外推荐使用 `defineFluxionOptions` 并具名导出 `config`：

```ts
// fluxion.config.ts
import { defineFluxionOptions } from 'fluxion-ts';

export const config = defineFluxionOptions({
  dir: 'dynamicDirectory',
  host: 'localhost',
  port: 9000,
  workerOptions: {
    maxWorkerCount: 4,
  },
});
```

第一阶段要求配置文件导出 `config` 对象；文档与示例统一使用 `defineFluxionOptions(...)` 返回标准配置项。

不做旧版兼容，不支持以下形式，除非后续明确需要：

```ts
export default { ... };
module.exports = { ... };
export const options = { ... };
```

原因：

- 入口唯一，错误提示简单。
- 避免为多个导出形态增加 adapter/wrapper。
- 和需求中的“导入 config 对象”一致。

## CLI 参数设计

第一阶段只实现必要参数：

```bash
fluxion --config <path> [--daemon]
fluxion stop --config <path>
fluxion restart --config <path>
fluxion status --config <path>
```

参数说明：

- `--config <path>`：必填，配置文件路径，支持相对路径和绝对路径。
- `--daemon`：后台守护启动。
- `stop`：停止 supervisor 与 app/primary。
- `restart`：先 stop 再 daemon start。
- `status`：读取 pid/status 文件并检查进程是否存活。

不在第一阶段实现：

- 多应用命名空间。
- pm2 风格进程列表。
- log rotate。
- 开机自启。
- cluster 数量的命令行覆盖。
- JSON/YAML 配置。

这些能力会显著增加分支和状态管理，先不做。

## 文件与目录设计

新增源码：

```text
src/cli.ts
```

构建输出：

```text
dist/cli.mjs
```

`package.json` 增加：

```json
{
  "bin": {
    "fluxion": "./dist/cli.mjs"
  },
  "files": [
    "dist"
  ]
}
```

运行态状态目录：

```text
.fluxion/
  <config-hash>.pid
  <config-hash>.json
  <config-hash>.out.log
  <config-hash>.err.log
```

状态目录默认位于执行命令时的 `process.cwd()` 下。

`config-hash` 使用配置文件绝对路径 hash，避免同一项目多个配置文件冲突。

## tsx 加载方案

### 关键决策

不要在主库运行时强绑定 tsx loader；只在 CLI 子进程中使用 tsx。

原因：

- 库模式 `import { fluxion } from 'fluxion-ts'` 不应被 CLI 依赖污染。
- app/primary/worker 都需要能加载 TypeScript 配置入口。
- Node cluster fork 需要继承可用的 TypeScript 运行环境。

### 推荐实现

CLI 自身是构建后的 JS：

```bash
node dist/cli.mjs --config fluxion.config.ts
```

当需要运行用户配置时，CLI spawn 一个 tsx 子进程：

```bash
node --import tsx dist/cli.mjs __app --config /abs/fluxion.config.ts
```

`__app` 模式中：

1. 设置必要环境变量。
2. 动态 import 配置文件。
3. 校验导出中存在 `config`。
4. 调用 `fluxion(config)`。

伪代码：

```ts
const mod = await import(pathToFileURL(configPath).href);
if (!('config' in mod)) {
  $throw('config file must export const config');
}
await fluxion(mod.config);
```

### 为什么不用直接在 CLI 里 `import(config)`

如果 `dist/cli.mjs` 直接 import `.ts` 配置文件：

- 普通 node 不能加载 `.ts`。
- 需要 CLI 进程自身也挂 `tsx` loader。
- 用户全局执行 `fluxion` 时，不一定是通过 `tsx fluxion` 启动。

因此由 CLI 明确 spawn `node --import tsx ... __app`，运行边界更清晰。

## cluster 与 tsx 的关系

`fluxion(config)` 内部会进入现有 cluster 逻辑：

- app 进程作为 primary 执行 `initPrimary(context)`。
- primary fork worker。
- worker 重新执行当前入口。

为了让 worker 也能重新加载 TypeScript 配置，app 进程必须通过 `node --import tsx dist/cli.mjs __app ...` 启动。Node cluster fork 会继承当前进程的 `execArgv`，因此 worker 也具备 tsx loader。

需要注意：

- `cluster.isPrimary` 时不会创建 watcher。
- worker 分支会重新 import config 并创建 context，这是可接受的。
- 配置文件应避免在顶层执行不可重复副作用；文档中需要提醒。

## daemon/supervisor 方案

### daemon 启动流程

```text
fluxion --config app.config.ts --daemon
  1. 解析 config 绝对路径
  2. 计算 config-hash
  3. 如果 pid 文件存在且进程存活，报错退出
  4. spawn detached supervisor
  5. 写入基础 status 文件
  6. 父进程打印 pid 与日志路径后退出

supervisor
  1. 打开 out/err log 文件
  2. spawn app 进程：node --import tsx dist/cli.mjs __app --config <abs>
  3. app 退出后判断是否需要重启
  4. 收到 SIGTERM/SIGINT 时停止 app 后退出
```

### 重启策略

第一阶段使用固定策略：

- app 非 0 退出：自动重启。
- app 被 signal 杀死：自动重启，除非 supervisor 正在停止。
- 1 分钟内最多重启 3 次，超过后 supervisor 退出并写入 failed 状态。

不新增可配置项，先保持行为固定，减少配置复杂度。

### stop 流程

```text
fluxion stop --config app.config.ts
  1. 定位 .fluxion/<config-hash>.json
  2. 读取 supervisorPid 和 appPid
  3. SIGTERM supervisor
  4. supervisor SIGTERM app
  5. 等待退出
  6. 删除 pid/status 文件或标记 stopped
```

### restart 流程

```text
fluxion restart --config app.config.ts
  1. stop
  2. daemon start
```

不做“平滑重启”旧进程接续，第一阶段直接停再起。

### status 流程

```text
fluxion status --config app.config.ts
  1. 读取 status 文件
  2. 检查 supervisorPid 是否存活
  3. 检查 appPid 是否存活
  4. 输出 running/stopped/failed/stale
```

## 信号处理

### app/primary 前台模式

```bash
fluxion --config app.config.ts
```

用户 Ctrl+C：

- CLI/app 收到 SIGINT。
- primary 退出。
- cluster worker 随 primary 生命周期结束。

### daemon 模式

```bash
fluxion --config app.config.ts --daemon
```

- supervisor 收到 SIGTERM：停止重启循环，向 app 发送 SIGTERM。
- app/primary 收到 SIGTERM：退出后 worker 也退出。
- supervisor 等待 app 退出，超时后 SIGKILL。

第一阶段 stop 超时建议：10 秒。

## 日志方案

daemon 模式写文件：

```text
.fluxion/<config-hash>.out.log
.fluxion/<config-hash>.err.log
```

不在第一阶段实现：

- `fluxion logs`。
- log rotate。
- 日志按日期切分。

原因：这些是 process manager 的扩展能力，不影响启动和守护闭环。

## 错误处理

必须给出明确错误：

- 缺少 `--config`。
- 配置文件不存在。
- 配置文件没有导出 `config`。
- `config` 不是对象。
- pid 文件存在且进程仍存活。
- stop/status 找不到状态文件。
- 当前 Node 无法使用 `--import tsx`。

`tsx` 依赖策略：

- 当前项目已经把 `tsx` 放在 devDependencies。
- 如果要让 npm 用户安装后直接使用 CLI 运行 `.ts` 配置，`tsx` 必须移到 dependencies。
- 否则发布包中 CLI 会找不到 tsx。

推荐：将 `tsx` 放入 `dependencies`，因为 CLI 运行 `.ts` 配置是核心能力。

## 构建方案

`tsdown.config.ts` 需要增加 CLI 入口，输出可执行文件：

```ts
entry: {
  index: 'src/index.ts',
  cli: 'src/cli.ts',
}
```

`src/cli.ts` 顶部需要 shebang：

```ts
#!/usr/bin/env node
```

构建后确保 `dist/cli.mjs` 保留 shebang。

如果当前构建工具不会自动设置 executable bit，发布前脚本需要 chmod：

```bash
chmod +x dist/cli.mjs
```

## 对现有 `src/index.ts` 的调整

当前 `src/index.ts` 在非 production 环境会自动启动一个默认服务：

```ts
if (process.env.NODE_ENV !== 'production') {
  fluxion({ ... });
}
```

这会和 CLI 行为冲突：

- CLI import `fluxion-ts` 时可能触发默认启动。
- 用户只想导入 API，也可能意外启动服务。

实现 CLI 前应删除这段自动启动逻辑。

开发启动改为显式命令：

```bash
fluxion --config fluxion.config.ts
```

或在项目内保留专用 demo script，而不是在包入口自动运行。

## 实施步骤

### 第一步：清理入口副作用

- 删除 `src/index.ts` 中 `if (process.env.NODE_ENV !== 'production') { ... fluxion(...) }`。
- 只保留导出。

### 第二步：新增 CLI 入口

新增 `src/cli.ts`，内部直接实现：

- 参数解析。
- config 路径解析。
- `__app` 模式。
- 前台启动。
- daemon/supervisor/stop/restart/status。

不新增 adapter/helper 层；少于 3 次的逻辑直接内联。

### 第三步：接入 package bin 与构建入口

- `package.json` 增加 `bin.fluxion`。
- `tsdown.config.ts` 增加 `cli` entry。
- `tsx` 移入 dependencies。

### 第四步：测试

新增或手动验证：

```bash
pnpm build
node dist/cli.mjs --config ./fluxion.config.ts
node dist/cli.mjs --config ./fluxion.config.ts --daemon
node dist/cli.mjs status --config ./fluxion.config.ts
node dist/cli.mjs restart --config ./fluxion.config.ts
node dist/cli.mjs stop --config ./fluxion.config.ts
```

需要验证：

- `.ts` 配置可以被加载。
- worker 可以正常 fork。
- worker 崩溃后 primary 自动重启 worker。
- app/primary 崩溃后 supervisor 自动重启 app。
- 1 分钟 3 次重启限制生效。
- stop 后不会被 supervisor 再拉起。

## 最小实现边界

第一阶段只实现：

- `fluxion --config xx.config.ts` 前台运行。
- `fluxion --config xx.config.ts --daemon` 后台守护。
- `stop/restart/status`。
- TypeScript config 通过 `tsx` 加载。
- supervisor 守护 primary。

明确不实现：

- pm2 完整替代。
- 多 app 列表管理。
- 日志查看命令。
- 开机自启。
- 平滑重载。
- 兼容 default export / CommonJS config。

## 最终结论

- `fluxion --config xx.config.ts` 应由新增 CLI 实现，CLI 通过 `node --import tsx` 进入 `__app` 模式加载 `config` 并调用 `fluxion(config)`。
- 当前 primary 已经能自动重启 worker，适合作为 worker supervisor。
- 当前 primary 不能替代 pm2，因为它不能守护自己；要实现 pm2 式守护，需要在 CLI 层新增 detached supervisor。
- 推荐保持职责分层：CLI/supervisor 管 primary，primary 管 worker，不把两层守护混在一个模块里。
