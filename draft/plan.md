# 动态加载 server(service/controller) 方案

## 目标
- 在 `dynamicDirectory/<module>/server` 下动态加载业务代码。
- 将业务拆成 `service` 和 `controller` 两层。
- 与现有 `find-my-way` 路由注册/卸载机制对接，支持热更新与回滚。

## 目录约定（建议）

```text
dynamicDirectory
└─ somemodule
   ├─ server
   │  ├─ index.js            # 模块清单(manifest)
   │  ├─ services
   │  │  ├─ user.service.js
   │  │  └─ ...
   │  ├─ controllers
   │  │  ├─ user.controller.js
   │  │  └─ ...
   │  └─ hooks.js            # 可选，生命周期钩子
   └─ web
      └─ ...
```

## server 模块导出协议（核心）
`server/index.js` 默认导出一个对象，包含：

```js
export default {
  services: {
    userService: ({ moduleName, logger }) => ({
      list: async () => [{ id: 1, name: 'Tom' }],
    }),
  },
  controllers: {
    userController: ({ services }) => ({
      list: async (ctx) => {
        const users = await services.userService.list();
        return { status: 200, body: { users } };
      },
    }),
  },
  routes: [
    { method: 'GET', path: '/users', controller: 'userController', action: 'list' },
  ],
  async onLoad(ctx) {},
  async onUnload(ctx) {},
};
```

说明：
- `services`：工厂函数集合，先创建。
- `controllers`：依赖 `services`，后创建。
- `routes`：声明式路由，仅描述 method/path/controller/action。
- `onLoad/onUnload`：热更新和卸载时用于资源初始化/清理。

## 运行时组件拆分
建议在 `src/core` 增加：

1. `module-loader.ts`
- 负责 `import()` 动态加载 `server/index.js`。
- 对每个模块维护 `moduleVersion`（mtime/hash）。
- 支持 cache busting（`import(fileUrl + '?v=' + version)`）。

2. `module-container.ts`
- 根据 manifest 构建 DI 容器。
- 顺序：`services -> controllers -> routes handler`。
- 暴露 `dispose()`，用于调用 `onUnload`。

3. `module-registry.ts`
- 内存态注册表：`moduleName -> { container, routes, version }`。
- 提供 `loadModule / reloadModule / unloadModule`。

4. `router.ts`（你现在已有）
- 保留命名空间注册：`/${module}/api/*`。
- 新增 `registerControllerRoutes(moduleName, routeDefs, invoker)`。

## 全流程（跑通链路）

### 1) 启动阶段
1. 扫描 `dynamicDirectory` 下模块目录。
2. 对每个模块执行 `loadModule`：
   - 读取并 import `server/index.js`。
   - 构建 container（service/controller）。
   - 注册 API 路由到 `/${module}/api/...`。
   - 注册 web 路由到 `/${module}/...`（静态资源后续补）。
3. 记录到 registry，打日志（jsonline + oneline）。

### 2) 请求阶段
1. `find-my-way` 命中 `/${module}/api/...`。
2. route handler 找到 `controller[action]`。
3. 构造 `RequestContext`（req/res/params/query/body/logger/moduleName）。
4. 执行 controller，返回 `{status, body, headers}` 或直接写 `res`。
5. 统一错误处理：500 + 错误日志。

### 3) 文件变更阶段（热更新）
1. `fs.watch` 触发后做 debounce + diff。
2. 分类：
   - 新增模块：`loadModule`。
   - 删除模块：`unloadModule` + `router.off`。
   - 已存在模块 server 代码变更：`reloadModule`。
3. `reloadModule` 使用“先构建后切换”策略：
   - 先加载新 container（不影响旧流量）。
   - 成功后原子替换路由引用。
   - 调用旧 container 的 `dispose`。
   - 若失败则保留旧版本并打 ERROR。

### 4) 模块删除阶段
1. 先 `router.off` 移除 `/${module}/api` + web 路由。
2. 调用 `onUnload` 做清理（DB/queue/timer）。
3. 从 registry 删除。

## 错误与稳定性策略
- 模块加载失败不应导致主进程退出；只影响该模块。
- 路由冲突（同 method/path）直接拒绝新模块并记录错误。
- controller 执行超时可选（后续加 `AbortController`）。
- 日志建议字段：`event/module/version/reason/durationMs/error`。

## 最小可落地迭代（建议顺序）
1. 定义 manifest 类型和校验（先手写校验即可）。
2. 实现 `module-loader.ts` + `module-registry.ts`。
3. 改造 `router.ts` 支持声明式 controller routes。
4. 接入现有 `watchDirectoryDiff` 做 reload/unload。
5. 补充一个示例模块 `dynamicDirectory/demo/server` 验证全链路。

---
这个方案的关键点是：**server 只做声明（manifest），运行时负责装配（DI + 路由 + 生命周期）**。这样才能稳定地动态加载、热更新、回滚。