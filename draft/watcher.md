# Watcher 解耦重构方案

## 背景

当前 watcher 架构中，`FluxionWatcherBase` 与 `router` 强耦合：
- `WatcherContext` 包含 `router` 字段
- `init()` 直接调用 `this.cx.router.register()`
- `queueUp()` 也直接调用 `this.cx.router.register()`
- `chokidar.ts` 和 `native.ts` 各自实现完整的 watcher（base + core 混合）

新增 cronjob watcher 时需要相同的文件侦听 + 防抖机制，但注册目标不同（manager 而非 router）。当前架构无法复用。

## 目标架构：Core → Base → Subclass 三层

```
WatcherCore (抽象)                    ← 文件侦听机制（chokidar / native fs.watch）
  ├── FluxionChokidarCore
  └── FluxionNativeCore
       ↓ 回调 onFileChanged(absolute, relative)
FluxionWatcherBase (抽象)             ← 防抖 + 生命周期管理（start/stop/init）
  ├── ApiWatcher                      ← onChange → router.register()
  └── CronJobWatcher                  ← onChange → manager.register()
```

## 分层职责

### WatcherCore（纯文件侦听抽象）

文件：`src/watcher/core.ts`

```typescript
interface FSWatcherAdapter {
  close(): void;
}

interface WatcherCoreOptions {
  dir: string;
  onFileChanged: (absolutePath: string, relativePath: string) => void;
  onError: (error: Error) => void;
  onReady?: () => void;
}

abstract class WatcherCore {
  protected readonly options: WatcherCoreOptions;
  constructor(options: WatcherCoreOptions) { ... }
  abstract start(): FSWatcherAdapter;
  abstract stop(): void;
}
```

两个实现：

- **FluxionChokidarCore**：使用 chokidar，cross-platform 支持好
  - `start()`: `chokidar.watch(dir, { persistent, ignoreInitial, awaitWriteFinish })`
  - 事件 `'all'` → `onFileChanged(absolutePath, path.relative(dir, absolutePath))`
  - 错误 → `onError()`，自动重启
- **FluxionNativeCore**：使用 `fs.watch(dir, { recursive: true })`
  - 事件回调中 relativePath 由 fs.watch 提供
  - `onFileChanged(path.join(dir, relativePath), relativePath)`
  - 错误 → `onError()`，自动重启

### FluxionWatcherBase（防抖 + 生命周期）

文件：`src/watcher/base.ts`（重构现有）

```typescript
abstract class FluxionWatcherBase {
  protected readonly dir: string;
  protected readonly reloadDelay: number;
  protected readonly logger: FluxionLogger;
  private readonly core: WatcherCore;

  private timer: NodeJS.Timeout | null = null;
  private readonly filesChanged = new Map<string, string>();

  constructor(cx: { options: { dir: string; reloadDelay: number }; logger: FluxionLogger }, core: WatcherCore) { ... }

  // 递归扫描目录，对每个文件调用 onChange
  protected async init(): Promise<this> { ... }

  // 防抖批量处理
  protected queueUp(absolutePath: string, relativePath: string): void {
    this.filesChanged.set(absolutePath, relativePath);
    if (this.timer) return;
    this.timer = setTimeout(async () => {
      const promises = [...this.filesChanged].map(([abs, rel]) =>
        this.onChange(abs, rel)
          .catch(err => this.logger.error(...))
          .finally(() => this.filesChanged.delete(abs)),
      );
      await Promise.all(promises);
      this.timer = null;
    }, this.reloadDelay);
  }

  // 子类实现具体注册逻辑
  abstract onChange(absolutePath: string, relativePath: string): Promise<void>;

  async start(): Promise<this> {
    this.stop();
    await this.init();
    this.core.start();
    return this;
  }

  stop(): this {
    this.core.stop();
    this.stopCore();
    return this;
  }

  protected stopCore(): void { /* 清理 timer 和 filesChanged */ }
}
```

### ApiWatcher（路由热重载）

文件：`src/watcher/api-watcher.ts`

```typescript
class ApiWatcher extends FluxionWatcherBase {
  constructor(cx: { options, logger, router }) {
    const core = options.nativeWatcher
      ? new FluxionNativeCore({ dir: options.dir, ... })
      : new FluxionChokidarCore({ dir: options.dir, ... });
    super(cx, core);
    this.router = cx.router;
  }

  async onChange(absolutePath: string, relativePath: string): Promise<void> {
    await this.router.register(absolutePath, relativePath);
  }
}
```

### CronJobWatcher（cronjob 热重载）

文件：`src/watcher/cronjob-watcher.ts`

```typescript
class CronJobWatcher extends FluxionWatcherBase {
  constructor(cx: { options, logger, cronJobManager }) {
    const core = options.nativeWatcher
      ? new FluxionNativeCore({ dir: options.cronjobDir, ... })
      : new FluxionChokidarCore({ dir: options.cronjobDir, ... });
    super(cx, core);
    this.manager = cx.cronJobManager;
  }

  async onChange(absolutePath: string, relativePath: string): Promise<void> {
    // 文件删除 → manager.unregister()
    // include/exclude 匹配检查
    // loadFluxionCronJob → manager.register()
  }
}
```

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `src/watcher/core.ts` | WatcherCore 抽象 + ChokidarCore + NativeCore |
| 重构 | `src/watcher/base.ts` | 移除 router 依赖，新增 core 参数和 onChange 抽象 |
| 新增 | `src/watcher/api-watcher.ts` | ApiWatcher（替代原 chokidar.ts/native.ts） |
| 新增 | `src/watcher/cronjob-watcher.ts` | CronJobWatcher |
| 删除 | `src/watcher/chokidar.ts` | 逻辑移入 core.ts |
| 删除 | `src/watcher/native.ts` | 逻辑移入 core.ts |
| 修改 | `src/types.d.ts` | `FluxionContext.watcher` 类型改为 `ApiWatcher` |
| 修改 | `src/fluxion.ts` | watcher 创建改用 `new ApiWatcher(context)` |

## 验证

1. 确认 ApiWatcher 功能与重构前一致（路由热重载正常）
2. 确认 CronJobWatcher 正确注册/注销 cronjob
3. 确认 chokidar 和 native 两种 core 都能正常工作
