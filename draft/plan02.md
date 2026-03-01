# Fluxion Worker + DB 路由实现方案（all/custom）

## 1. 目标
- 为动态 handler 引入可配置的 worker + 数据库连接策略。
- `workerStrategy` 仅支持两种形式：
  - `'all'`
  - `custom` 数组（用户定义每个 worker 可访问的 db 列表）
- 无论哪种策略，运行时都保证至少存在一个“全库 worker”（`dbSet = all databases`）。

---

## 2. 配置模型

### 2.1 服务器配置新增字段
```ts
interface FluxionOptions {
  // 现有字段...
  databases: DatabaseConfig[]; // [{ name: 'orders', ... }, ...]
  workerStrategy?:
    | 'all'
    | Array<{
        id: string;
        db: string[];
        maxInflight?: number;
        requestTimeoutMs?: number;
      }>;
}
```

### 2.2 规范化后内部模型
```ts
interface NormalizedWorkerSpec {
  id: string;
  dbSet: string[]; // 排序+去重
  maxInflight: number;
  requestTimeoutMs: number;
  isFallbackAllDb: boolean;
}
```

---

## 3. handler 声明模型

### 3.1 `defineHandler` 返回结构
```ts
export default defineHandler({
  db: ['orders', 'audit'],
  timeoutMs: 3000,
  handler: async (ctx) => { ... },
});
```

### 3.2 元数据要求
- `db` 可为 string 或 string[]，内部统一为去重排序数组。
- 缺省时可视为 `[]`（不需要数据库）。
- 运行时以 `db` 作为 worker 匹配依据。

---

## 4. Worker 创建规则

### 4.1 `workerStrategy = 'all'`
- 创建 1 个 worker：`dbSet = all databases`。
- 所有 handler 都由该 worker 执行。

### 4.2 `workerStrategy = custom[]`
- 先按 custom 创建 worker 集合。
- 检查是否已存在 `dbSet == all databases` 的 worker。
  - 若存在：直接复用。
  - 若不存在：自动追加 `fallback-all-db` worker。
- 若 custom 内有重复 `dbSet`，可合并或报错（建议报配置错误，避免歧义）。

### 4.3 空库场景
- `databases = []` 时，仍可创建一个 worker（`dbSet=[]`）。
- 此时 fallback-all-db 也等价于空集合 worker。

---

## 5. Worker 匹配算法（最小匹配原则）

输入：`requiredDbSet`（来自 handler 元数据）

1. 候选集合：`requiredDbSet ⊆ worker.dbSet`
2. 候选按以下优先级排序：
   1) `worker.dbSet.size` 最小（最小超集）
   2) `inflight` 最小（负载更低）
   3) `id` 字典序（稳定 tie-break）
3. 选择第一名 worker。
4. 理论上不会无候选（因为始终有全库 worker）；若仍无候选，返回 500 并记录配置错误日志。

---

## 6. DB 连接生命周期

### 6.1 worker 内连接策略
- 每个 worker 仅初始化其 `dbSet` 对应的连接池。
- 推荐“懒初始化”：首次访问某 db 时才创建连接。

### 6.2 退出与重启
- worker 关闭/重启前执行池清理（`pool.end()`）。
- 若超时/崩溃重启，主进程自动替换 worker，后续请求继续按匹配路由。

### 6.3 风险约束
- 对 `fallback-all-db` 标记高权限并在日志中可见。
- 建议每 worker 每库 pool 上限较小（如 1~2），避免连接爆炸。

---

## 7. 代码改造点

1. `src/core/server.ts`
   - 解析 `databases` + `workerStrategy`。
   - 构建 `NormalizedWorkerSpec[]` 并传给 runtime。

2. `src/workers/file-runtime.ts`
   - 从单 `handlerWorkerPool` 改为 `workerPools[]`。
   - 动态 handler 执行前读取 handler 元数据（`db`），调用匹配器选 pool。

3. `src/workers/handler-worker-pool.ts`
   - 每个 pool 持有自己的 `dbSet` 与运行指标。
   - 快照新增 `dbSet`、`isFallbackAllDb`。

4. `src/workers/handler-worker.ts`
   - 支持按 `dbSet` 初始化 DB 客户端容器。
   - 执行 handler 时只暴露该 worker 允许的数据库句柄。

5. `src/core/meta-api.ts`
   - `/ _fluxion/workers` 输出每个 worker 的 `dbSet`、是否 fallback、inflight、重启次数、内存。

---

## 8. 校验与报错策略
- 启动时校验：
  - `databases.name` 不可重复。
  - `custom[].id` 不可重复。
  - `custom[].db` 必须都是已声明数据库名。
- 对非法配置直接启动失败（fail fast）。

---

## 9. 兼容与迁移
- 旧 handler（默认导出函数）继续支持。
- 新 handler（`defineHandler`）逐步接管 DB 声明能力。
- 在过渡期：
  - 没有声明 `db` 的旧 handler 视为 `[]`。
  - 若旧逻辑仍需全库访问，可通过配置路由到 fallback-all-db worker。

---

## 10. 里程碑
1. M1：配置与规范化（all/custom + fallback-all-db 自动补齐）
2. M2：多 worker pool 与最小匹配路由
3. M3：worker 内 dbSet 连接容器 + 生命周期管理
4. M4：meta 可观测性补齐 + e2e 测试（匹配正确性/重启/降级）
