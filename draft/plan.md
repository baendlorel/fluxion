# Fluxion Worker 隔离执行方案（内存 + 超时）

## 1. 问题与目标
- 问题：`await import(fileUrl?v=...)` 会让 ESM 缓存持续增长，热更新越久内存越大。
- 目标：
  1) 将业务 handler 与主进程隔离；
  2) 限制单个执行单元的内存与响应时间；
  3) 异常时快速熔断/重启，避免拖垮主进程。

## 2. 总体架构
- 主进程（HTTP 接入层）职责：
  - 接收请求、基础校验、静态文件服务、路由解析；
  - 将动态请求通过 RPC 发给 Worker；
  - 负责超时控制、队列控制、降级响应。
- Worker（执行层）职责：
  - 加载并执行 handler 文件；
  - 维护本 Worker 内的模块缓存；
  - 仅返回可序列化结果（status/body/headers/error）。
- 热更新策略：
  - 发现文件版本变化时，不在同一 Worker 内“无限 import 新版本”；
  - 直接重建 Worker（旧 Worker 退出即释放其模块缓存）。

## 3. 隔离模型（基于 worker_threads）
- 每个“模块目录”或“路由分片”绑定 1 个 Worker（可配置）。
- 主进程与 Worker 仅通过消息通信（`postMessage`），不共享 handler 实例。
- Worker 只接收瘦身后的请求数据：`method/url/headers/body/query/ip/requestId`。
- Worker 不直接持有 `http.ServerResponse`，避免越权写响应。

## 4. 内存限制方案
- 启动 Worker 时设置 `resourceLimits`：
  - `maxOldGenerationSizeMb`（如 128）；
  - `maxYoungGenerationSizeMb`（如 32）；
  - `stackSizeMb`（如 4）。
- 运行时监控：
  - Worker 定期上报 `process.memoryUsage()`（如每 5s）；
  - 主进程维护 `softLimit`/`hardLimit`。
- 触发策略：
  - 软阈值（例如 80%）：暂停接收新请求，优先 drain；
  - 硬阈值（例如 100% 或连续增长）：`terminate()` 并拉起新 Worker。
- 队列保护：
  - 每 Worker 限制 `maxInflight` 与 `maxQueue`；
  - 超出立即返回 503，避免主进程堆积内存。

## 5. 响应时间限制方案
- 每次转发到 Worker 时创建 deadline（例如 `requestTimeoutMs=3000`）。
- 到时未返回：
  1) 主进程立即回 504；
  2) 将该 Worker 标记为不健康并 `terminate()`；
  3) 自动重建 Worker。
- 慢请求分级：
  - `slowMs`（如 500）只打日志；
  - `timeoutMs` 强制失败+重启。

## 6. 让主进程不被拖累的关键点
- 只在主进程做轻逻辑：路由、鉴权前置、静态文件、日志汇总。
- 主进程不等待无上限队列：有上限、可拒绝、可熔断。
- Worker 异常（OOM/死循环/未捕获异常）由 supervisor 重建，不影响监听 socket。
- 对同一路由的连续失败启用短路（circuit breaker）：在冷却窗口直接 503。

## 7. 最小接口草案
```ts
// main -> worker
interface WorkerRequest {
  id: string;
  routeKey: string;
  filePath: string;
  version: string;
  method: string;
  url: string;
  headers: Record<string, string | string[]>;
  body?: Uint8Array;
  query: Record<string, string | string[]>;
  ip: string;
  timeoutMs: number;
}

// worker -> main
interface WorkerResponse {
  id: string;
  ok: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  error?: { code: string; message: string; stack?: string };
  metrics?: { elapsedMs: number; heapUsed: number };
}
```

## 8. 与现有 `file-runtime.ts` 的改造点
- 保留现有“文件路由解析 + 静态文件处理”。
- 将 `loadHandler()` 从主进程移到 Worker 内。
- 主进程不再执行 `import(fileUrl?v=...)`；改为：
  - `resolveHandlerFile()` 得到 `filePath + version`；
  - 按 `routeKey` 选择 Worker；
  - 若版本变化，重建对应 Worker 后再派发请求。

## 9. 迭代落地顺序
1. v1：单 Worker 跑所有动态路由（先打通协议、超时、重建）。
2. v2：按路由分片多个 Worker + 队列/并发上限。
3. v3：内存阈值策略 + 熔断 + 监控指标（重启次数、超时率、拒绝率）。
4. v4：可选升级到子进程池（更强故障隔离）。

## 10. 现实约束与建议
- `worker_threads` 是“线程隔离 + V8 isolate”，但仍在同一进程；
- 对“强隔离（尤其 native 内存、进程级崩溃）”要求高时，建议最终切到 `child_process` 池；
- 当前阶段先用 Worker 可以快速解决 ESM 热更新缓存增长，并显著降低主进程被慢请求拖累的风险。
