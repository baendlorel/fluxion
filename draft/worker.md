# Fluxion Workers 架构梳理

## 1. 总体结构（主线程 -> Worker 线程）

Fluxion 的 workers 相关代码可以分成 4 层：

1. 路由与请求装配层（主线程）
   - `src/workers/file-runtime/runtime-factory.ts:32` `createFileRuntime`
   - 负责路由匹配、读取请求体、组装 worker payload、回写响应。
2. Worker 绑定与调度层（主线程）
   - `src/workers/file-runtime/worker-bindings.ts:14` `createWorkerBindings`
   - `src/workers/file-runtime/worker-bindings.ts:34` `selectExecutionWorker`
   - 负责“有哪些 worker”以及“本次请求选哪个 worker”。
3. Worker 池监督层（主线程）
   - `src/workers/handler-worker-pool.ts:234` `createHandlerWorkerPool`
   - `HandlerWorkerPoolImpl` 负责 worker 生命周期、超时、重启、内存阈值、inflight 请求管理。
4. Worker 执行层（worker 线程）
   - `src/workers/handler-worker.ts:904` `execute`
   - 负责加载 handler、创建内存版 req/res、执行业务函数、序列化结果返回。

IPC 协议定义在：
- `src/workers/protocol.d.ts:46` `Payload`
- `src/workers/protocol.d.ts:80` `ExecuteMessage`
- `src/workers/protocol.d.ts:132` `ResultMessage`
- `src/workers/protocol.d.ts:157` `MemoryMessage`

---

## 2. 关键执行链路

1. 服务收到请求后进入 `fileRuntime.handleRequest`
   - `src/workers/file-runtime/runtime-factory.ts:234`
2. 解析路径并匹配 handler 文件（优先 `index.mjs`）
   - `parseRequestPath` `src/workers/file-runtime/path-utils.ts:65`
   - `buildHandlerCandidates` `src/workers/file-runtime/path-utils.ts:100`
   - `getFileVersion` `src/workers/file-runtime/file-system.ts:18`
3. 读取请求体 + 组装 payload
   - `readRequestBody` `src/workers/file-runtime/request-utils.ts:89`
4. 调用 worker pool 执行
   - `execute` `src/workers/handler-worker-pool.ts:336`
5. pool 确保 worker 存活、登记 inflight、发 IPC
   - `executeOnce` `src/workers/handler-worker-pool.ts:441`
   - `ensureWorker` `src/workers/handler-worker-pool.ts:504`
6. worker 收到 `execute` 消息后执行 handler
   - `execute` `src/workers/handler-worker.ts:904`
   - `loadHandler` `src/workers/handler-worker.ts:874`
7. worker 返回 `ResultMessage`（可 transfer body buffer）
   - `postOutboundMessage` `src/workers/handler-worker.ts:966`
8. pool 收到结果并 resolve promise
   - `handleWorkerMessage` `src/workers/handler-worker-pool.ts:575`
9. 主线程将序列化响应写回真实 `ServerResponse`
   - `applyWorkerResponse` `src/workers/file-runtime/request-utils.ts:188`

---

## 3. 状态与一致性机制（复杂度核心）

### 3.1 双版本校验（防止热更新时缓存错位）

- 主线程版本表：`versionsByFilePath`
  - `src/workers/handler-worker-pool.ts:271`
  - 每次请求前 `assertKnownVersion` 检查
  - `src/workers/handler-worker-pool.ts:737`
- worker 内版本表：`handlerCache`
  - `src/workers/handler-worker.ts:139`
  - `loadHandler` 中二次校验版本
  - `src/workers/handler-worker.ts:874`
- 任一层检测到版本不一致，抛 `WORKER_VERSION_MISMATCH`，pool 会重启并重试一次
  - `executeWithRetry` `src/workers/handler-worker-pool.ts:422`

### 3.2 自动重启策略（可恢复机制）

- 触发来源：
  - 请求超时：`WORKER_TIMEOUT`（`executeOnce` 里的 timer）
  - worker error / exit：`ensureWorker` 注册事件
  - 内存超阈值：`handleMemoryMessage`
- 重启入口：
  - `restart` `src/workers/handler-worker-pool.ts:639`（串行互斥）
  - `performRestart` `src/workers/handler-worker-pool.ts:659`（清状态、terminate、拉起新 worker）

### 3.3 模块注入生命周期（modules）

- 解析导出格式与 `modules` 声明：
  - `parseModuleDefault` `src/workers/handler-worker.ts:544`
  - `parseHandlerModuleDeclarations` `src/workers/handler-worker.ts:287`
- 工厂函数“字符串化再恢复”：
  - `createModuleFactory` `src/workers/handler-worker.ts:343`
- 连接建立与冲突检测：
  - `ensureWorkerModuleConnections` `src/workers/handler-worker.ts:483`
- 注入到 handler 第三个参数 `context`：
  - `createHandlerContext` `src/workers/handler-worker.ts:578`
- worker 退出前清理模块资源：
  - `closeWorkerModuleConnections` `src/workers/handler-worker.ts:512`
  - `disposeModuleConnections` `src/workers/handler-worker.ts:1008`

---

## 4. 重要函数标记

标记说明：
- `P0`：主链路/稳定性核心，改动前必须完整理解
- `P1`：扩展能力或重要策略点
- `P2`：辅助与边界保护

| 级别 | 函数 | 位置 | 作用 |
| --- | --- | --- | --- |
| P0 | `createFileRuntime` | `src/workers/file-runtime/runtime-factory.ts:32` | workers 架构总入口，串起路由匹配、worker 执行、静态兜底 |
| P0 | `handleRequest` | `src/workers/file-runtime/runtime-factory.ts:234` | 每个请求的 runtime 主流程 |
| P0 | `execute` | `src/workers/handler-worker-pool.ts:336` | 主线程调用 worker 的统一入口 |
| P0 | `executeOnce` | `src/workers/handler-worker-pool.ts:441` | inflight、timeout、IPC 发送的核心 |
| P0 | `ensureWorker` | `src/workers/handler-worker-pool.ts:504` | worker 拉起与事件监督（error/exit/message） |
| P0 | `restart` / `performRestart` | `src/workers/handler-worker-pool.ts:639` / `:659` | 故障恢复、状态清理与 worker 轮换 |
| P0 | `execute` | `src/workers/handler-worker.ts:904` | worker 侧执行入口（handler 调用与结果封装） |
| P0 | `loadHandler` | `src/workers/handler-worker.ts:874` | handler 缓存与版本一致性校验 |
| P0 | `MemoryServerResponse.appendChunk` | `src/workers/handler-worker.ts:783` | 限制 worker 响应体大小，避免内存膨胀 |
| P0 | `postOutboundMessage` | `src/workers/handler-worker.ts:966` | 结果回传及 body transfer，影响性能/拷贝成本 |
| P1 | `handleMemoryMessage` | `src/workers/handler-worker-pool.ts:609` | 基于内存采样触发软/硬阈值重启 |
| P1 | `executeWithRetry` | `src/workers/handler-worker-pool.ts:422` | 版本错位时自动重试机制 |
| P1 | `parseModuleDefault` | `src/workers/handler-worker.ts:544` | 统一 function/object 两种 handler 写法 |
| P1 | `ensureWorkerModuleConnections` | `src/workers/handler-worker.ts:483` | modules 注入的幂等与冲突检测 |
| P1 | `createModuleFactory` | `src/workers/handler-worker.ts:343` | factory 恢复与安全边界（闭包隔离） |
| P1 | `readRequestBody` | `src/workers/file-runtime/request-utils.ts:89` | 请求体读取与限流（413） |
| P1 | `applyWorkerResponse` | `src/workers/file-runtime/request-utils.ts:188` | 序列化响应回写主线程响应对象 |
| P2 | `parseRequestPath` | `src/workers/file-runtime/path-utils.ts:65` | 路由段合法性与安全过滤 |
| P2 | `buildHandlerCandidates` | `src/workers/file-runtime/path-utils.ts:100` | handler 候选顺序（`index.mjs` 优先） |
| P2 | `buildRouteSnapshot` | `src/workers/file-runtime/route-snapshot.ts:11` | meta 路由快照生成 |
| P2 | `resolveExecutorOptions` | `src/workers/options.ts:46` | worker 运行参数默认值合并 |

---

## 5. 当前实现特点（读代码时的重点）

1. 当前 worker 绑定默认只有 1 个
   - `createWorkerBindings` 固定创建 `fluxion-worker-all`
   - `src/workers/file-runtime/worker-bindings.ts:9` / `:14`
2. 但接口已预留多 worker 调度能力
   - `selectExecutionWorker` 使用最小 inflight 选择
   - `src/workers/file-runtime/worker-bindings.ts:34`
3. worker 健康信息可通过 snapshot 暴露
   - `getSnapshot` `src/workers/handler-worker-pool.ts:379`
   - 对接 meta API 的 `/workers`

---

## 6. 推荐阅读顺序（最快建立全局心智）

1. `src/workers/file-runtime/runtime-factory.ts`
2. `src/workers/handler-worker-pool.ts`
3. `src/workers/handler-worker.ts`
4. `src/workers/protocol.d.ts`
5. `src/workers/file-runtime/request-utils.ts` + `path-utils.ts`
