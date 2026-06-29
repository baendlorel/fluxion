# Fluxion Primary 简易优雅关闭方案

## 目标

本方案只解决一件事：当新实例发现旧实例存在时，旧实例在收到 `SIGTERM` 后，能够由 primary 主导完成一次有顺序、有超时、可兜底的退出流程，而不是只依赖单个 pid 消失。

本方案优先保证：

1. primary 收到退出信号后，不再继续拉起或重启 worker。
2. primary 会主动通知所有 worker 退出。
3. primary 会等待 worker 退出，但不会无限等待。
4. 如果超时仍有 worker 未退出，primary 会立刻强制结束残留 worker，不再继续等待。
5. 全部 worker 结束后，primary 再做实例注销并退出。

## 不做的事情

这个简单版先不做以下内容：

1. 不引入新的 metaPort shutdown API。
2. 不把 worker pid 持久化到 `instances.json`。
3. 不做跨机器、多用户、跨 supervisor 的复杂控制面。
4. 不做 tree kill 的通用封装，只先处理当前 cluster worker 模型。

## 现状问题

基于当前代码，主要有这几个问题：

1. `launcher.ts` 中实例管理器监听了 `SIGTERM`，但目前会很快走到 `process.exit(...)`，这会抢走 primary 自己的 shutdown 编排权。
2. `primary.ts` 有 respawn / recycle 逻辑，但没有 `shuttingDown` 标志，关闭过程中可能一边关 worker，一边又把 worker 拉起来。
3. `worker.ts` 已经具备基本优雅退出逻辑，但现在缺少 primary 统一下发关闭动作并等待收敛。
4. 目前 launcher 等的是 primary pid 消失，但 primary pid 消失不严格等于整个旧实例已经干净退出。

## 简单版总体思路

### 1. 关闭入口仍然是 SIGTERM

旧实例的 primary pid 仍由 launcher 通过 `process.kill(pid, 'SIGTERM')` 发送关闭信号。

不通过 metaPort 作为主入口，原因是：

1. launcher 已经拿到了 old primary pid。
2. 进程信号不依赖 HTTP 管理口是否健康。
3. 这是进程生命周期问题，信号比管理接口更底层、更稳。

### 2. primary 增加统一 shutdown 状态

在 `primary.ts` 中增加：

1. `let shuttingDown = false`
2. `let shutdownPromise: Promise<void> | null = null`

作用：

1. 防止多个退出入口重复执行关闭流程。
2. 让 respawn / recycle / spawn 路径能够感知“现在正在关闭”。

### 3. primary 增加 beginShutdown(signal)

新增一个统一方法，例如：

```ts
async function beginShutdown(signal: NodeJS.Signals) {}
```

职责如下：

1. 首次进入时设置 `shuttingDown = true`。
2. 记录日志，标明 shutdown 开始、signal 类型、当前 worker 数量。
3. 停止新的 worker lifecycle 行为。
4. 停止定时器和探活逻辑。
5. 向现有所有 worker 发送 `SIGTERM`。
6. 等待所有 worker 退出。
7. 超时后强制 kill 仍然存活的 worker。
8. 等残留 worker 真正结束。
9. 调用实例注销逻辑。
10. 最终让 primary 退出。

### 4. 所有 worker lifecycle 分支都要尊重 shuttingDown

以下路径都要先判断 `shuttingDown`：

1. `initiateRecycle(...)`
2. `spawnSlot(...)`
3. `worker.on('exit', ...)` 里的自动 respawn

规则很简单：

1. 正常运行时，维持现有逻辑。
2. 一旦 `shuttingDown === true`，不再 recycle、不再 respawn、不再补位。

这样可以避免 shutdown 期间又拉起新的 worker。

### 5. worker 继续沿用现有 SIGTERM 优雅退出逻辑

`worker.ts` 现有逻辑已经接近可用：

1. 收到 `SIGTERM` / `SIGINT` 后进入 `shutdown(signal)`。
2. 停掉 watcher。
3. `server.close(...)` 停止接受新请求并等待已建立连接收敛。
4. 10 秒后超时退出。

这个简单版不改 worker 的总体机制，只做必要的小修正。

## 超时与强制退出策略

### Primary 级超时

primary 的 `beginShutdown(...)` 需要一个总超时，例如：

1. `PRIMARY_SHUTDOWN_TIMEOUT_MS = 10_000`
2. `PRIMARY_SHUTDOWN_POLL_INTERVAL_MS = 200`

关闭流程：

1. 给所有 worker 发 `SIGTERM`
2. 轮询检查还有哪些 worker 没退出
3. 超时后，对残留 worker 立刻执行强制 kill

这里“立刻 kill，不要再等了”建议解释为：

1. 一旦达到总超时，不再继续优雅等待
2. 直接对残留 worker 发 `SIGKILL`
3. 然后只做非常短的一次确认或直接进入 primary 退出

如果要最保守，可以在 `SIGKILL` 后再给一个非常短的确认窗口，比如 500ms 到 1000ms；如果你要最硬的行为，也可以 `SIGKILL` 后直接继续 primary 退出。

## Launcher 侧的调整

`launcher.ts` 的职责要收窄，不再自己抢做 shutdown 编排。

建议调整为：

1. `FluxionInstanceManager` 不再在 `SIGTERM` 监听器里立即 `process.exit(...)`。
2. `SIGTERM` 的主要处理职责交回给 primary。
3. launcher 的 `kill(pid)` 只负责：
   1. 给 old primary 发 `SIGTERM`
   2. 等 old primary pid 消失
   3. 超时则返回失败，或按约定直接退出当前新实例

也就是说：

1. primary 负责“把自己和 worker 收干净”
2. launcher 负责“请求旧实例退出，并等待旧 primary 结束”

## 建议改动点

### 1. `src/cluster/primary.ts`

需要增加：

1. `shuttingDown`
2. `shutdownPromise`
3. `beginShutdown(signal)`
4. 对 `SIGTERM` / `SIGINT` 的统一监听
5. 定时器停止逻辑
6. worker 全量关闭与超时强杀逻辑
7. 在 respawn / recycle 路径上的 `shuttingDown` 判断

### 2. `src/cluster/worker.ts`

大概率只需要小改：

1. 保持现有 shutdown 逻辑
2. 如有必要，把当前 10 秒超时常量提取出来，方便和 primary 侧对齐

### 3. `src/cluster/launcher.ts`

需要调整：

1. 去掉或弱化实例管理器中会抢先 `process.exit(...)` 的 signal 监听
2. 保留旧实例 pid 探测与等待逻辑
3. 明确超时失败的返回语义

## 简单版执行顺序

旧实例关闭时，预期顺序如下：

1. 新实例 launcher 发现 old primary。
2. launcher 对 old primary 发 `SIGTERM`。
3. old primary 的 `beginShutdown('SIGTERM')` 启动。
4. old primary 设置 `shuttingDown = true`。
5. old primary 停止 ping / recycle / respawn。
6. old primary 给所有 worker 发 `SIGTERM`。
7. workers 各自执行 `server.close(...)` 和资源清理。
8. primary 等待 worker 全部退出。
9. 达到总超时后，primary 对残留 worker 发 `SIGKILL`，不再继续优雅等待。
10. primary 注销实例记录。
11. primary 退出。
12. 新实例 launcher 观察到 old primary pid 消失，继续注册并启动。

## 这个方案的边界

这个简单版已经比“只看 primary pid”更稳，但仍然有边界：

1. 如果 worker 内部未来还会 spawn 外部子进程，单纯 `SIGTERM` / `SIGKILL` worker 可能不足以清理所有孙子进程。
2. `process.on('exit', ...)` 不适合承载异步清理，因此真正的 shutdown 主路径必须放在 `SIGTERM` / `SIGINT`。
3. 如果 future 需要手动管理关闭过程，再考虑把 metaPort 作为辅入口，但它不应成为主关闭入口。

## 结论

这个简单版方案的核心判断是：

1. 关闭入口用 `SIGTERM`
2. 关闭编排放在 primary 内部
3. 用 `shuttingDown` 阻止 shutdown 期间的 respawn / recycle
4. worker 先优雅退出
5. 超时后立刻强制 kill 残留 worker，不再继续等待

如果这个方向确认无误，下一步再开始正式改代码。