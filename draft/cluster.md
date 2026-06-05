# Fluxion 多 Worker 路由分配方案设计

## 当前问题分析

在多 Worker 环境下，现有架构存在以下问题：

1. **每个 Worker 独立注册路由**
   - 每个 Worker 都有自己独立的 `FluxionRouter` 实例
   - 每个 Worker 都会监听文件变化并注册/删除 handler
   - 但 HTTP 请求只会被一个 Worker 处理（由 cluster 模式的负载均衡决定）
   - 如果请求被发送到没有注册该 handler 的 Worker，就会返回 404

2. **Cluster 模式的局限性**
   - Node.js cluster 模式的负载均衡是基于操作系统层面的
   - 默认情况下，请求分发是轮询的，无法控制请求路由到哪个 Worker
   - Worker 之间无法直接通信，需要通过主进程转发

## 设计原则

- **一致性**：同一请求始终路由到同一个 Worker
- **均衡性**：负载尽可能均匀分布
- **可预测性**：开发者能够明确知道哪个文件由哪个 Worker 处理
- **容错性**：Worker 崩溃后，路由能够重新分配
- **低开销**：路由决策不应带来显著性能损失
- **易维护性**：开发者容易理解和调试

## 方案分类

### A. 静态哈希分配（推荐用于简单场景）

#### A1. 文件名哈希取模

```typescript
// 伪代码
function getWorkerId(filepath: string, workerCount: number): number {
  const hash = crypto.createHash('sha256').update(filepath).digest();
  const num = hash.readUInt32BE(0);
  return num % workerCount;
}
```

**优点**：
- 实现简单
- 负载分布相对均匀
- 无需额外配置

**缺点**：
- 文件新增/删除可能导致大量路由重新分配
- 开发者无法预测哪个 Worker 处理哪个文件
- Worker 数量变化时，所有路由都需要重新分配

**适用场景**：
- 文件数量大且相对稳定
- 不需要精细控制路由分配

#### A2. 文件路径哈希

```typescript
function getWorkerId(filepath: string, workerCount: number): number {
  const normalized = path.normalize(filepath).toLowerCase();
  const hash = simpleHash(normalized); // DJB2 or MurmurHash
  return hash % workerCount;
}
```

**优点**：
- 路径相同的请求总是路由到同一 Worker
- 大小写不敏感，避免重复注册

**缺点**：
- 同 A1

### B. 基于规则/约定的分配（推荐用于大多数场景）

#### B1. 目录/前缀划分（推荐 ⭐）

```typescript
// 配置示例
const routeRules = [
  { pattern: /^api\//, workerId: 1 },      // api/ 目录下的文件给 Worker 1
  { pattern: /^admin\//, workerId: 2 },    // admin/ 目录下的文件给 Worker 2
  { pattern: /^public\//, workerId: 3 },   // public/ 目录下的文件给 Worker 3
  { pattern: /.*/, workerId: 1 },         // 默认给 Worker 1
];

function getWorkerId(filepath: string): number {
  for (const rule of routeRules) {
    if (rule.pattern.test(filepath)) {
      return rule.workerId;
    }
  }
  return 1; // 默认
}
```

**优点**：
- ✅ 开发者可以明确控制路由分配
- ✅ 易于理解和调试
- ✅ 可以按业务功能模块划分
- ✅ 文件新增/删除不影响其他路由

**缺点**：
- 需要手动配置规则
- 如果某个目录的文件特别多，可能导致负载不均

**适用场景**：
- 明确的业务模块划分
- 需要精细控制路由分配
- 中小型项目

#### B2. 文件标签/元数据

在文件中定义元数据，指定由哪个 Worker 处理：

```typescript
// test.ts
// @fluxion { worker: 1 }
export default function handler(req, res) {
  // ...
}
```

**优点**：
- 最大灵活性
- 可以针对单个文件精细控制

**缺点**：
- 需要修改所有文件
- 容易遗漏
- 维护成本高

#### B3. 配置文件映射

```yaml
# routes.yaml
api/user:
  worker: 1
  priority: high
api/order:
  worker: 2
  priority: high
static:
  worker: 3
  priority: low
```

**优点**：
- 集中配置，易于管理
- 可以添加额外元数据（优先级、资源限制等）

**缺点**：
- 需要维护额外配置文件
- 容易与实际文件不同步

### C. 中央路由器模式（推荐用于大型项目）

#### C1. 主进程作为路由层（推荐 ⭐⭐）

```
Client Request → Primary Process (Router) → Worker 1/2/3/N
```

主进程维护全局路由表，根据规则转发请求到对应 Worker：

```typescript
// primary.ts
const routeTable = new Map<string, number>(); // filepath -> workerId

function getWorkerForPath(urlPath: string): number {
  const handler = routeTable.get(urlPath);
  return handler || getDefaultWorker();
}

// 主进程监听文件变化，更新路由表
watcher.on('change', (filepath) => {
  const targetWorker = assignRoute(filepath);
  routeTable.set(filepath, targetWorker);

  // 通知所有 Worker
  workers.forEach(w => w.send({ type: 'ROUTE_UPDATE', filepath, workerId: targetWorker }));
});

// 主进程作为 HTTP 代理
httpServer.on('request', (req, res) => {
  const workerId = getWorkerForPath(req.url);
  forwardToWorker(workerId, req, res);
});
```

**优点**：
- ✅ 完全控制路由分配策略
- ✅ 可以实现复杂的负载均衡算法
- ✅ 易于监控和调试
- ✅ 支持动态调整 Worker 数量

**缺点**：
- 主进程成为瓶颈，增加延迟
- 实现复杂度高
- 需要进程间通信

**适用场景**：
- 大型项目
- 需要灵活的路由策略
- 可以接受轻微性能损失

#### C2. 专用路由 Worker

```
Client Request → Router Worker → Worker 1/2/3/N
```

**优点**：
- 主进程职责单一
- 路由逻辑独立，易于升级

**缺点**：
- 增加额外的进程开销
- 架构更复杂

### D. 动态/自适应分配

#### D1. 基于负载动态分配

```typescript
// 每个 Worker 定期报告负载
worker.on('stats', ({ cpu, memory, requestCount }) => {
  workerLoad.set(workerId, { cpu, memory, requestCount });
});

// 根据当前负载分配路由
function getWorkerId(filepath: string): number {
  // 优先选择负载最低的 Worker
  return Array.from(workerLoad.entries())
    .sort((a, b) => a[1].requestCount - b[1].requestCount)[0][0];
}
```

**优点**：
- 自动平衡负载

**缺点**：
- 实现复杂
- 路由不固定，可能导致会话问题（如果有状态）
- 需要持续监控和通信

#### D2. 一致性哈希（推荐用于动态扩展）

```typescript
// 使用虚拟节点实现一致性哈希
const virtualNodes = 100; // 每个 Worker 对应 100 个虚拟节点
const ring = new Map<number, number>(); // hash -> workerId

function initHashRing(workerCount: number) {
  for (let w = 0; w < workerCount; w++) {
    for (let i = 0; i < virtualNodes; i++) {
      const hash = hashFunction(`${w}-${i}`);
      ring.set(hash, w);
    }
  }
}

function getWorkerId(filepath: string): number {
  const hash = hashFunction(filepath);
  // 找到顺时针方向第一个虚拟节点
  const targetHash = Array.from(ring.keys())
    .filter(h => h >= hash)
    .sort((a, b) => a - b)[0];
  return ring.get(targetHash);
}
```

**优点**：
- ✅ 增加/减少 Worker 时，只需重新分配少量路由
- ✅ 负载分布相对均匀
- ✅ 适合动态扩缩容

**缺点**：
- 实现复杂
- 需要 O(log n) 的查找时间

### E. 混合方案

#### E1. 按类型分层分配

```typescript
// 不同类型的服务分配给不同的 Worker
const strategy = {
  static: { workerCount: 2, algorithm: 'hash' },      // 静态资源用 2 个 Worker，哈希分配
  api: { workerCount: 4, algorithm: 'prefix' },       // API 用 4 个 Worker，按前缀分配
  ws: { workerCount: 1, algorithm: 'dedicated' },     // WebSocket 用专用 Worker
};
```

**优点**：
- 针对不同类型优化

**缺点**：
- 配置复杂

## 推荐方案总结

| 方案 | 复杂度 | 可控性 | 适用场景 |
|------|--------|--------|----------|
| A1. 文件名哈希 | 低 | 低 | 小型项目，无需控制 |
| B1. 目录划分（推荐 ⭐） | 中 | 高 | 中大型项目，业务清晰 |
| C1. 主进程路由 | 高 | 最高 | 大型项目，需要动态调整 |
| D2. 一致性哈希 | 高 | 中 | 需要动态扩缩容 |

## 针对当前 Fluxion 架构的建议

### 方案 1：目录划分（最简单有效）

```typescript
// fluxion.config.ts
export default {
  workers: [
    { id: 1, routes: ['api/**'] },
    { id: 2, routes: ['admin/**'] },
    { id: 3, routes: ['public/**', '**/*.js', '**/*.css'] },
  ],
};
```

### 方案 2：简化为单 Worker

如果不需要多核利用率，直接移除 cluster 模式：

```typescript
// fluxion.config.ts
export default {
  useCluster: false,  // 单进程模式
};
```

### 方案 3：主进程路由（最灵活）

将 HTTP 服务器放在主进程，主进程根据路由表转发请求到 Worker。

## 实现建议

1. **先实现方案 B1（目录划分）**
   - 修改 `fluxion.ts`，让 Worker 只注册属于自己的路由
   - 主进程监听文件变化，通知对应 Worker

2. **保留单进程模式作为默认**
   - 大多数用户不需要多 Worker
   - 简化默认配置

3. **提供配置选项**
   ```typescript
   interface FluxionOptions {
     clustering?: {
       enabled: boolean;
       strategy?: 'single' | 'prefix' | 'hash' | 'central';
       workers?: number;
       routes?: Record<string, number>; // filepath pattern -> workerId
     };
   }
   ```

## 下一步

根据实际需求选择方案并实现。如果当前不需要多 Worker，建议：
1. 先移除 cluster 模式，保持简洁
2. 如果将来需要，可以再基于 B1 方案实现
