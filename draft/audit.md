# 审计记录

> 记录代码审查中发现的非紧急问题，供后续决策参考。

---

## P2: `staticResourceTimeoutMs` 默认值错误

### 现象

**代码** (`src/defines/options.ts:90`)：

```ts
staticResourceTimeoutMs = 10 * 600000,  // 6,000,000ms = 100 分钟
```

**文档** (`src/types.ts:71`)：

```ts
/**
 * Default to 10 minutes 10*60*1000ms.
 */
```

### 分析

- `10 * 60 * 1000 = 600,000`（10 分钟）——这是文档意图的值
- `10 * 600000 = 6,000,000`（100 分钟）——这是代码实际的值

`10 * 600000` 看起来像是 `10 * 60 * 1000` 的笔误，把 `60 * 1000` 合并成了 `600000` 却忘了乘以 10。也就是说，写代码的人本意是 `10 * 60 * 1000`，但合并计算时多了一个数量级。

### 影响

- 静态资源（大文件下载）的超时等待时间长达 100 分钟，而非预期的 10 分钟
- 如果一个静态资源请求卡住，会占用连接资源 100 分钟才释放
- 资源泄漏的问题更难被发现（因为超时时间太长）

### 修复建议

将 `staticResourceTimeoutMs = 10 * 600000` 改为 `staticResourceTimeoutMs = 10 * 60 * 1000`（或者直接写 `600000` 并加注释说明是 10 分钟）。

我：改为3分钟

### 修复结果

`staticResourceTimeoutMs = 10 * 600000` → `3 * 60 * 1000`（3 分钟）。

---

## P3: HTTPS 类型定义与运行时校验矛盾

### 现象

**类型定义** (`src/types.ts:126-130`)：

```ts
export interface FluxionOptions {
  https?: {
    key: string | Buffer;   // 允许 Buffer
    cert: string | Buffer;  // 允许 Buffer
    ca?: string | Buffer | Array<string | Buffer>;
  };
}
```

**运行时校验** (`src/defines/options.ts:41-45`)：

```ts
if (typeof https.key !== 'string') {
    _throw('FluxionOptions.https.key must be a string');
}
if (typeof https.cert !== 'string') {
    _throw('FluxionOptions.https.cert must be a string');
}
```

### 分析

类型定义说 `key` 和 `cert` 可以是 `string | Buffer`，但运行时校验只接受 `string`。这是典型的**类型定义与实现不一致**。

`readCertificateContent` 函数（`src/defines/options.ts:9-25`）实际上**完全支持 Buffer 输入**：

```ts
function readCertificateContent(content: string | Buffer, moduleDir: string): Buffer {
  if (Buffer.isBuffer(content)) {
    return content;  // 直接返回 Buffer
  }
  // ... 处理字符串（文件路径或 PEM 内容）
}
```

所以校验逻辑狭窄了，但底层函数是支持的。修复方向有两种：

1. **收紧类型定义**：将 `key` 和 `cert` 改为 `string` 类型，去掉 `Buffer` 选项
2. **放宽校验**：在校验中加入 `typeof https.key !== 'string' && !Buffer.isBuffer(https.key)` 以匹配类型定义

### 推荐方案

方案 2 更合理。既然 `readCertificateContent` 已经支持 Buffer，校验应该匹配。而且用户从文件读证书内容得到 Buffer 是常见场景。

我：是的，允许buffer

### 修复结果

校验改为 `typeof https.key !== 'string' && !Buffer.isBuffer(https.key)`，错误信息也对应更新为 `'must be a string or Buffer'`。

---

## P4: 错误信息泄露到客户端

### 现象

**代码** (`src/http/server.ts:171-175`)：

```ts
catch (e) {
  // ...
  safeSendJson(res, { message: getErrorMessage(e) }, ...);
}
```

当 handler 或 middleware 抛出异常时，`e.message` 被直接序列化到 HTTP 响应体返回给客户端。

### 分析

在 fluxion 的设计中，**应用程序代码（handler）跑在 fluxion 进程内，与 fluxion 共享内存空间**。这与 PHP（每次请求全新进程）不同，更接近传统 Node.js 框架。

风险场景：

1. **数据库连接串泄露**：handler 连接数据库时密码错误，抛出 `Error('connect ECONNREFUSED 192.168.1.100:5432')`，内部 IP 暴露
2. **内部路径泄露**：handler 调用 `fs.readFileSync('/etc/app/secret.key')` 失败，抛出 `Error('ENOENT: no such file or directory, open \'/etc/app/secret.key\'')`，内部路径暴露
3. **SQL 语句泄露**：ORM 错误包含原始 SQL，暴露表结构
4. **第三方 SDK 错误**：云服务凭证、token 可能出现在错误消息中

此外，`getErrorMessage` 的 fallback 分支 `(e as any)?.message || String(e)` 在 `String(e)` 时可能输出完整的错误堆栈。

### 严重程度判断

- 对于**面向公网的生产环境**：中高危，错误信息可能帮助攻击者收集情报
- 对于**内部服务/开发环境**：低风险，错误信息有助于调试
- Fluxion 定位为 PHP 替代方案，通常用于后端 API，但仍应区分环境

### 修复建议

1. 在生产环境（`NODE_ENV=production`）只返回通用错误信息，如 `{ message: 'Internal Server Error' }`
2. 保留具体错误信息到日志，不返回给客户端
3. 对于 `HttpException` 可以保留消息（因为这类异常是开发者主动抛出的，消息是设计好的）

我：是的，日志肯定是保留的，返回的参数就不要那么详细了

### 修复结果

- `HttpException`（开发者主动抛出的异常）：保留消息，返回给客户端
- 非 `HttpException`（意外错误）：日志保留完整错误信息，客户端只收到 `{ message: 'Internal Server Error' }`，不再返回 `getErrorMessage(e)` 的原始内容

---

## P5: 安全响应头缺失及其他小问题

### 5.1 缺少安全响应头

所有响应（API 和静态资源）都没有设置以下安全头：

| 响应头                            | 作用                  | 缺失风险                                                                   |
| --------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| `X-Content-Type-Options: nosniff` | 禁止浏览器 MIME 嗅探  | 攻击者上传的`.txt` 文件含 HTML 内容，浏览器可能嗅探为 `text/html` 执行 XSS |
| `X-Frame-Options: DENY`           | 禁止页面被嵌入 iframe | 点击劫持（Clickjacking）攻击                                               |
| `Content-Security-Policy`         | 限制资源加载来源      | XSS 攻击者可以加载外部脚本                                                 |

**影响评估：** 对于 API 服务器（非 HTML 页面），`X-Content-Type-Options` 和 `CSP` 的价值较低，因为响应通常是 JSON。但如果 fluxion 同时服务静态资源（HTML/CSS/JS），这些头就很重要了。

**建议：** 在 `src/http/server.ts` 中增加一个中间件/钩子，为所有响应设置 `X-Content-Type-Options: nosniff`。更完整的方案可以提供一个选项让用户配置自定义响应头。

我：再看看这三个是否也可以加上
```
X-Frame-Options: DENY

X-XSS-Protection: 1; mode=block

Content-Security-Policy
```

### 修复结果

在 `src/http/server.ts` 的请求处理入口处（`requestHandler` 函数开头）为所有响应设置了以下安全头：

```ts
res.setHeader('X-Content-Type-Options', 'nosniff');
res.setHeader('X-Frame-Options', 'DENY');
res.setHeader('X-XSS-Protection', '1; mode=block');
res.setHeader('Content-Security-Policy', "default-src 'self'");
```

### 5.2 Cookie 解析无大小限制

**代码** (`src/http/cookie.ts:4-21`)：

```ts
export function parseCookie(cookieHeader: string | undefined): Record<string, string> {
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [key, ...valueParts] = pair.split('=');
    // ...
  }
}
```

攻击者可以发送一个巨大的 Cookie 头（如 `a=1; b=2; c=3; ...` 重复数千次），`split` 操作会分配大量内存，可能导致 CPU 和内存消耗飙升（虽然不是经典 DoS，但叠加其他瓶颈可能放大影响）。

**影响评估：** 低风险。Node.js 的 HTTP 解析器本身有 header 大小限制（`--max-http-header-size`，默认 16KB），所以实际能到达 `parseCookie` 的 Cookie 大小是有限的。

**建议：** 不修复也可以，但可以在循环中加一个简单的 key 数量上限（如 100 个）作为防御纵深。

我：那就加 key 数量上限

### 修复结果

在 `parseCookie` 中增加了 `MAX_COOKIE_KEYS = 100` 上限，超过上限的 key 被忽略。

### 5.3 `process.exit(1)` 阻止了上层优雅恢复

**代码** (`src/http/server.ts:225-228`)：

```ts
server.on('error', (e) => {
  if (listening) {
    process.exit(1);
  }
  reject(e);
  process.exit(1);  // 双重 exit
});
```

- 如果服务器在监听后遇到错误（如 socket 异常），直接 `process.exit(1)`，不给上层调用者（如 PM2 或用户代码）处理机会
- `reject(e)` 后的 `process.exit(1)` 让 reject 变得无意义（永远不会有 catch 执行）
- 两个分支都 `exit(1)`，`reject(e)` 是死代码

**建议：** 让 `listening` 后的错误只记录日志，不 `exit(1)`。让上层（PM2/用户代码）决定如何处理。或者至少移除 `reject(e)` 后面的 `exit(1)`，让 Promise 正常 reject。
我：好的

### 修复结果

- `listening` 后的错误：记录日志后 `return`，不再 `process.exit(1)`，让上层调用者决定如何处理
- 启动过程中的错误：`reject(e)` 后不再 `process.exit(1)`，Promise 正常 reject

### 5.4 Logger 文件流提前创建

**代码** (`src/common/logger.ts:100`)：

```ts
const fileStream = createWriteStream(logFilePath, { flags: 'a' });
```

只要设置了 `FLUXION_INSTANCE_LOG` 环境变量，就会立即创建一个文件写入流并持有文件描述符，即使没有日志写入。对于大规模部署（数百个实例），每个实例即使没有日志也会占用一个文件描述符。

**建议：** 延迟创建文件流，只在第一次写入时创建。或者使用 `open` 选项 `'wx'` 并加上缓存。
我：先不改

---

## 已修复问题

### P0: ✅ 路径遍历漏洞

**修复方式：** 在 `src/router/lazy.ts` 的 `register()` 和 `get()` 方法中增加检查：

```ts
if (!absolutePath.startsWith(this.cx.options.dir + path.sep)) {
  return undefined;  // 拒绝访问 dir 以外的文件
}
```

`get()` 中的检查是防御纵深（在 `fs.stat` 前快速失败），`register()` 中的检查是兜底保障（确保任何注册路径都不会逃逸）。
我：回答是否一定要" + path.sep"

**答：** 是的，必须加 `path.sep`。原因是防止目录前缀碰撞。例如：
- `dir` = `/home/user/app`
- 攻击者请求 `/app-other/secret.ts`
- 无 `path.sep`：`/home/user/app-other/secret.ts`.startsWith(`/home/user/app`) → ⚠️ 误判为通过
- 有 `path.sep`：实际检查前缀 `/home/user/app/` → ✅ 正确拒绝

### P1: ✅ 已理解，不处理

- 测试文件有 `globalThis._throw` 兜底
- 构建产物（dist/）中 `@rollup/plugin-replace` 将 `_throw('...')` 替换为 `throw new Error('[fluxion error]...')`，错误信息带 `[fluxion error]` 前缀，更友好
- 开发/调试时通过 `tsx` 运行，测试文件有定义，所以实际不会出现 `ReferenceError`