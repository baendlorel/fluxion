# Fluxion Daemon 设计方案

## 目标

希望同时满足这 4 件事：

1. `fluxion --config xxx.config.ts` 可以把服务放到后台运行。
2. 后续命令行可以再次连接到这个后台进程，而不是只能靠 pid 文件盲操作。
3. 后台进程可以守护真正的 fluxion app 进程。
4. 如果后台进程发现 app 长时间失去回应，并且检查 pid 后确认它真的退出了，就主动重新拉起。

这件事的核心不是 primary 本身，而是要在 primary 之外再加一层 **daemon/supervisor**。

---

## 先说结论

需要拆成两层：

```text
CLI 命令
  -> daemon 进程（常驻）
      -> app 进程（真正执行 fluxion(config)）
          -> primary / workers
```

职责分层：

- **CLI**：一次性命令入口，只负责“连接 daemon / 启动 daemon / 发指令 / 打印结果”。
- **daemon**：常驻后台，保存状态，接受 CLI 连接，请求 app 心跳，判定是否重启。
- **app**：真正执行 `fluxion(config)`。
- **primary**：app 内部已有的 worker 守护者。

也就是：

- **daemon 守护 app**
- **primary 守护 worker**

不要把这两层揉在一起。

---

## 为什么不能只靠现在的 primary

当前 `src/cluster/primary.ts` 已经能：

- worker 崩溃后重启 worker
- worker 健康超时后重启 worker
- worker 内存超限后重启 worker

但它做不到：

- primary/app 自己退出后再把自己拉起来
- 接受外部 CLI 控制命令
- 保存后台运行状态
- 后台常驻并维持控制通道

原因很简单：**一个已经退出的进程，无法自己重启自己。**

所以必须增加一个更外层的常驻 daemon。

---

## 推荐的运行模型

### 1. start

```bash
fluxion --config ./fluxion.config.ts
```

行为：

- 如果该 config 对应的 daemon 不存在，则启动 daemon。
- CLI 不直接运行 app，而是把“启动 app”的请求交给 daemon。
- daemon 再拉起 app。
- CLI 打印状态后退出。

也就是对用户来说，这个命令默认就是“后台托管启动”。

### 2. status

```bash
fluxion status
```

行为：

- CLI 连接 daemon。
- daemon 返回：
  - daemon pid
  - app pid
  - 当前 state
  - 最近心跳时间
  - 最近重启次数
  - 日志路径

### 3. stop

```bash
fluxion stop
```

行为：

- CLI 连接 daemon。
- daemon 先停止自动拉起逻辑。
- daemon 向 app 发停止信号。
- app 退出后 daemon 也退出，或至少进入 stopped 状态。

### 4. logs

```bash
fluxion logs
```

行为：

- CLI 连接 daemon，拿到 out/err log 路径。
- CLI 自己 `tail -f`，或直接由 daemon 读文件回传。

第一阶段更简单的做法是：daemon 只返回日志路径，CLI 自己读。

---

## 关键设计：CLI 不是直接操作 pid，而是先连接 daemon

你提到“命令行能够连接上这个进程”，这点很关键。

这意味着不能只依赖：

- pid 文件
- status json
- `kill(pid, 0)`

这些只能证明“某个 pid 还活着”，不能证明：

- 它是不是 fluxion 的 daemon
- 它是否还持有正确的 app 状态
- 它是否还能响应命令

所以需要一个 **控制通道**。

---

## 控制通道推荐方案

### 推荐：Unix Domain Socket

每个 config 对应一个 socket 文件：

```text
.fluxion/
  <config-hash>.sock
```

CLI 和 daemon 通过本地 socket 通信。

优点：

- 只在本机可见，天然不暴露公网。
- 不需要额外端口管理。
- 可以很容易知道“daemon 是否真的在监听”。
- 适合单机进程控制。

不推荐第一阶段直接用 TCP localhost 端口，因为：

- 还要处理端口冲突
- 还要决定端口发现机制
- 对你当前目标来说是无意义复杂度

### 通信格式

直接用 json line：

```json
{"type":"status"}
{"type":"stop"}
{"type":"start"}
{"type":"logs"}
{"type":"ping"}
```

daemon 回：

```json
{"ok":true,"state":"running","appPid":12345}
```

不要第一阶段引入复杂 RPC 协议。

---

## 运行时文件布局

每个 config 对应一个 hash：

```text
.fluxion/
  <hash>.sock
  <hash>.daemon.pid
  <hash>.app.pid
  <hash>.state.json
  <hash>.out.log
  <hash>.err.log
```

说明：

- `daemon.pid`：daemon 的 pid
- `app.pid`：当前 app 的 pid
- `sock`：CLI 与 daemon 的连接入口
- `state.json`：最后一次持久化状态，给排障和兜底用
- `out.log` / `err.log`：app 输出重定向

这里 `state.json` 只是辅助，不作为主控制手段。

---

## daemon 内部状态模型

daemon 内存里维护一个状态对象：

```ts
{
  configPath: string,
  daemonPid: number,
  appPid: number | null,
  state: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed' | 'restarting',
  startedAt: number | null,
  lastHeartbeatAt: number | null,
  lastAppResponseAt: number | null,
  restartCount: number,
  restartLog: number[],
  logs: {
    out: string,
    err: string,
  }
}
```

建议状态尽量少，不要做太细的状态机。

第一阶段足够用的状态：

- `starting`
- `running`
- `stopping`
- `stopped`
- `restarting`
- `crashed`

---

## app 与 daemon 如何互相确认“还活着”

这里需要两套检查，不要只做一套。

### 第一套：心跳检查

daemon 定时向 app 发 ping，请 app 回 pong。

#### 做法 A：单独建一个 app control socket

app 启动后监听：

```text
.fluxion/<hash>.app.sock
```

daemon 周期性连接这个 socket 发：

```json
{"type":"ping"}
```

app 返回：

```json
{"type":"pong","pid":12345,"at":1710000000000}
```

优点：

- 真的知道 app 的事件循环还活着。
- 不是只看 pid 存在。
- 可以扩展更多调试命令。

缺点：

- app 侧要再暴露一个本地控制 socket。

#### 做法 B：daemon 直接监控 app IPC

如果 app 就是 daemon `spawn` 出来的子进程，可以使用 `stdio` 之外再开一个 `ipc` 通道：

```ts
spawn(process.execPath, args, { stdio: ['ignore', out, err, 'ipc'] })
```

daemon 发：

```ts
child.send({ type: 'ping' })
```

app 回：

```ts
process.send?.({ type: 'pong', at: Date.now() })
```

**推荐第一阶段用这个。**

原因：

- 不需要再多开一个 app socket
- 进程关系本来就是 daemon spawn app
- 实现最短

---

## 第二套：pid 校验

你要求的是：

> 如果它失去回应，并且检测 pid 后发现真的退出了，那么会主动拉起它。

这意味着逻辑必须是：

1. 先发现 app 没回应。
2. 再检查 pid。
3. 如果 pid 已经不存在，立即拉起。
4. 如果 pid 还在，则不要马上拉起，而是先判定它“卡死”。

所以要区分两种情况。

### 情况 1：没回应，且 pid 不存在

说明 app 已经真的退出。

动作：

- 直接进入 `restarting`
- 清理旧 pid / 旧 ipc 状态
- spawn 新 app

### 情况 2：没回应，但 pid 还存在

说明 app 可能：

- 卡死
- 死循环
- 长时间阻塞事件循环
- IPC 通道损坏

动作不要立刻“再拉一个”，否则会产生双实例风险。

正确做法：

- 先标记 unhealthy
- 向它发送 `SIGTERM`
- 等一小段时间，例如 5 秒
- 若仍然存活，再 `SIGKILL`
- 确认 pid 消失后再 spawn 新 app

所以完整策略是：

```text
heartbeat timeout
  -> check pid
    -> if pid missing: restart now
    -> if pid exists: terminate old app, wait exit, then restart
```

---

## 为什么不能只靠 pid

因为 pid 存活不代表服务活着。

例如：

- 死循环
- event loop 卡死
- 已经不接请求
- 仍在，但内部逻辑完全失效

所以：

- **pid 检查** 只能确认“进程还在不在”
- **心跳检查** 才能确认“进程还能不能响应”

这两者必须同时存在。

---

## 守护循环怎么写

daemon 内部维护一个定时器，例如每 5 秒跑一次：

```text
tick
  1. 如果没有 appPid，且 state 不是 stopped -> 尝试启动 app
  2. 如果有 appPid -> 发 ping
  3. 记录 pong 超时情况
  4. 若超过 timeout -> 检查 pid
  5. 若 pid 不存在 -> 立即重启
  6. 若 pid 还存在 -> 杀掉旧进程，再重启
  7. 记录 restartLog，做防风暴限制
```

### 推荐参数

- 心跳发送间隔：5s
- pong 超时：15s 或 30s
- 优雅退出等待：5s
- 强制杀死等待：10s
- 防风暴窗口：60s
- 窗口内最大重启次数：3

这和你现在 primary 那套思路是一致的，只是对象从 worker 换成 app。

---

## 自动拉起时如何避免 fork storm

必须保留重启节流。

例如：

```ts
restartLog = timestamps in last 60s
if restartLog.length >= 3 {
  state = 'crashed'
  stop auto restart
}
```

否则如果配置文件错误、端口冲突、启动即崩，会一直狂重启。

这部分建议完全复用当前 primary 的思路，不要重新发明。

---

## CLI 与 daemon 的连接流程

### 启动流程

```text
fluxion --config a.ts
  1. 计算 hash
  2. 查 .sock 是否存在
  3. 尝试连接 .sock
     - 连上：发送 start
     - 连不上：检查 daemon.pid
       - pid 存在但 sock 不可用 -> 视为 stale daemon，清理残留文件
       - pid 不存在 -> 启动新的 daemon
  4. 新 daemon 启动后监听 .sock
  5. CLI 再连接 .sock 发送 start
```

### status 流程

```text
fluxion status
  1. 连接 .sock
  2. 请求 status
  3. daemon 返回完整状态
  4. 若无法连接，再检查 daemon.pid
     - pid 不存在：输出 stopped
     - pid 存在但无 socket：输出 stale
```

### stop 流程

```text
fluxion stop
  1. 连接 .sock
  2. 发送 stop
  3. daemon 切到 stopping
  4. 停 app
  5. 清 socket/pid/state
  6. daemon 退出
```

---

## app 入口怎么组织

不要让 CLI 直接 `import config` 后就在当前命令进程跑服务。

推荐拆成两个内部模式：

```text
fluxion cli
fluxion __daemon
fluxion __app
```

### `__daemon`

负责：

- 常驻后台
- 监听控制 socket
- spawn / kill / restart app
- 做心跳
- 持久化状态

### `__app`

负责：

- 在 tsx 环境里导入 `config`
- 执行 `fluxion(config)`
- 响应 daemon 的 ping

这样边界最清楚。

---

## app 如何响应 ping

因为 daemon 需要判断“app 是否失去回应”，所以 app 必须最少支持：

```ts
process.on('message', (message) => {
  if (message?.type === 'ping') {
    process.send?.({
      type: 'pong',
      pid: process.pid,
      at: Date.now(),
    });
  }
});
```

然后 daemon 侧维护：

- `lastPingAt`
- `lastPongAt`

如果 `Date.now() - lastPongAt > timeout`，就进入异常处理。

这个机制比“只监听 child exit”更强，因为它能发现“进程还活着但已经卡死”。

---

## 与 cluster/primary 的关系

app 内部仍然是：

```text
__app -> fluxion(config) -> cluster primary -> workers
```

这里 daemon 不需要直接管 worker。

原因：

- worker 的健康与重启已经是 primary 的职责。
- daemon 的职责只到 app 层。
- 否则会导致控制面交叉、重复重启、状态混乱。

所以职责边界一定要保持：

- daemon 不碰 worker 细节
- primary 不碰 daemon 控制协议

---

## 配置文件与 TSX

app 必须通过 tsx 环境启动，否则 `.ts` 配置无法加载。

推荐启动命令：

```bash
node --import tsx dist/cli.mjs __app --config /abs/path/fluxion.config.ts
```

这样：

- `config` 可以是 `.ts`
- cluster fork 会继承这套 `execArgv`
- worker 也能运行在可加载 TS 的环境中

---

## 最小协议设计

daemon 控制 socket 只需要这几个请求：

### request

```ts
{ type: 'start' }
{ type: 'stop' }
{ type: 'status' }
{ type: 'logs' }
{ type: 'ping' }
```

### response

```ts
{ ok: true, state: 'running', appPid: 123 }
{ ok: true, outLog: '...', errLog: '...' }
{ ok: false, error: '...' }
```

保持单行 JSON 即可。

---

## 推荐的第一阶段实现范围

第一阶段只做：

1. 每个 config 一个 daemon。
2. daemon 使用 Unix socket 与 CLI 通信。
3. daemon spawn 一个 app。
4. daemon 通过 IPC ping/pong 监控 app。
5. 心跳超时后先查 pid。
6. pid 不存在则直接重启。
7. pid 仍存在则杀掉后再重启。
8. 加防风暴限制。
9. `status/stop/logs` 都走 daemon socket。

第一阶段不做：

- 多 app 列表
- 远程机器管理
- Web UI
- 热升级 daemon 自己
- 日志订阅流协议
- daemon 重启后恢复旧 app 的复杂接管

---

## 推荐实现步骤

### 第一步：补 daemon 类型与状态模型

在 `src/cli/types.ts` 增加：

- daemon state 类型
- socket request/response 类型
- runtime state 类型

### 第二步：实现 daemon 入口

在 `src/cli/index.ts` 或单独模块中加入 `__daemon` 内部模式。

### 第三步：实现 socket server

daemon 启动后：

- 监听 `.fluxion/<hash>.sock`
- 接收 `start/status/stop/logs`
- 回 JSON

### 第四步：实现 app IPC 心跳

app 侧响应 `ping`。
daemon 侧定时发 `ping`，超时判定。

### 第五步：实现 pid + timeout 双判定重启

严格执行：

```text
先 heartbeat timeout
再 pid check
再决定 restart
```

### 第六步：接 CLI

CLI 所有外部命令都优先走 socket。
只有在 socket 不存在时，才走 pid 文件兜底。

---

## 一句话总结

如果要满足：

- 后台运行
- CLI 可重新连上
- 能守护进程
- 失去回应后先查 pid，再决定拉起

那么最合适的方案是：

**每个 config 启一个常驻 daemon，用 Unix socket 作为 CLI 控制通道，用 child IPC 做 app 心跳，用 pid 校验做重启确认。**

也就是：

- socket 解决“怎么连上它”
- ping/pong 解决“它还有没有回应”
- pid check 解决“它是不是真的死了”
- daemon 解决“谁来拉起它”

