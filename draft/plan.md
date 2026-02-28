# Fluxion 下一阶段方案草案（隔离 + 统一开发体验）

## 1. 目标
- 在保持「文件即路由」的同时，解决多模块上线后的核心问题：能力隔离、访问隔离、数据库连接、数据共享、统一认证。
- 提供更舒适的 handler 编写方式：返回值驱动响应、`throw` 驱动错误响应，减少直接操作 `res` 的样板代码。

---

## 2. 总体原则
- **默认最小权限**：模块默认不能访问高风险能力，按需申请。
- **显式共享**：跨模块数据/能力必须通过声明式接口，不允许隐式全局读写。
- **统一入口**：认证、审计、错误格式统一走框架层。
- **渐进升级**：兼容旧 `(req, res)`，新写法逐步迁移。

---

## 3. 能力隔离（Capability Isolation）

### 3.1 运行单元
建议两级模式：
1. **基础模式（默认）**：同进程执行，性能高，适合内部可信模块。
2. **隔离模式（可选）**：模块在 `worker_threads` 或子进程运行，通过 RPC 与主进程通信。

### 3.2 能力声明
模块根目录增加清单（如 `module.json`）：

```json
{
  "name": "orders",
  "capabilities": ["db:orders", "cache:shared", "http:outbound"],
  "auth": { "required": true, "scopes": ["orders:read"] }
}
```

### 3.3 能力注入
运行时只把已授权能力注入到 `ctx.services`，例如：
- `ctx.services.db`
- `ctx.services.cache`
- `ctx.services.http`

未授权能力访问直接抛 `ForbiddenCapabilityError`（记录审计日志）。

---

## 4. 访问隔离（Access Isolation）

### 4.1 路由隔离
- 保持当前命名空间：每个模块只能处理其路径下请求（由文件路径决定）。
- `_` 前缀目录继续不可路由。

### 4.2 认证后鉴权
- 统一认证中间件先解析身份（JWT/API Key/Session）。
- 鉴权策略分两层：
  1) 模块级 scope（如 `orders:*`）
  2) 路由级 scope（如 `orders:write`）

### 4.3 审计日志
请求结束日志追加：
- `subject`（用户/客户端标识）
- `module`
- `authResult`、`policy`、`denyReason`

---

## 5. 数据库连接方式

### 5.1 连接管理
- 框架侧维护 `DbManager`，按数据源名集中管理连接池。
- 模块不能直接持有 DSN，只拿到已授权的数据源句柄。

### 5.2 最小权限账号
- 建议每模块独立数据库账号/Schema。
- 共享数据走受控视图或只读账号，避免跨模块直接写表。

### 5.3 事务边界
- 以请求为单位提供可选事务上下文：`ctx.tx`。
- 若跨模块操作，优先事件驱动补偿，不做跨库强一致分布式事务。

---

## 6. 数据共享方案

建议分三类：
1. **读多写少配置**：`ConfigStore`（只读快照 + 热更新）
2. **短期共享状态**：`SharedCache`（Redis/内存，带 key 前缀）
3. **业务事件**：`EventBus`（异步解耦，显式订阅）

规则：
- 禁止模块直接读取其他模块私有目录/私有 DB 表。
- 跨模块协作只能走 `API` 或 `EventBus`。

---

## 7. 更舒适的 Handler 编程模型

### 7.1 新签名（推荐）
支持：
```ts
export default async function handler(ctx) {
  return { data: { ok: true } };
}
```

兼容旧签名：
```ts
export default function handler(req, res) {}
```

### 7.2 `ctx` 结构（建议）
- `ctx.req` / `ctx.res`
- `ctx.params`（仅在显式动态路由后引入）
- `ctx.query`
- `ctx.body`（已解析）
- `ctx.user`（认证结果）
- `ctx.services`（按能力注入）
- `ctx.meta`（requestId、ip、method、path）

### 7.3 返回值到响应的映射
- `return { data }` => `200 + application/json`
- `return { status, data, headers }` => 自定义状态/头
- `return ResponseLike` => 直接透传
- `return undefined` 且未写 `res` => `204`

### 7.4 throw 到错误响应
提供统一错误类：
- `BadRequestError` -> 400
- `UnauthorizedError` -> 401
- `ForbiddenError` -> 403
- `NotFoundError` -> 404
- `ConflictError` -> 409

示例：
```ts
import { badRequest } from 'fluxion/http';

export default async function handler(ctx) {
  if (!ctx.query.id) throw badRequest('missing id');
  return { data: { id: ctx.query.id } };
}
```

---

## 8. 统一认证处理

### 8.1 认证流水线
`request -> parse token -> verify -> attach user -> authorize -> handler`

### 8.2 策略声明
支持在模块或文件级声明：

```ts
export const auth = {
  required: true,
  scopes: ['orders:read']
};
```

### 8.3 框架内置能力
- Token 提取（`Authorization`, cookie, query 可配置）
- 多策略验证器（JWT / API Key）
- 统一 401/403 错误格式

---

## 9. 建议落地顺序（最小可行迭代）
1. **v1.1**：引入 `ctx` + 返回值映射 + 错误类（兼容旧 `(req,res)`）
2. **v1.2**：统一认证中间件 + 模块/路由 scope
3. **v1.3**：能力声明与服务注入（db/cache/http）
4. **v1.4**：DbManager + 多数据源权限模型
5. **v1.5**：可选隔离执行（worker/process）+ 资源配额

---

## 10. 关键收益
- 模块职责更清晰，跨模块风险显著降低。
- 新写法代码量明显减少，接口行为更统一。
- 鉴权、日志、错误处理全部收敛到框架层，便于审计与运维。