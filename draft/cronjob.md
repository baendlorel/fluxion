# Cronjob 功能实现计划

## 背景

为 fluxion-ts 添加 cronjob 功能，支持热重载。用户已安装 `cron-parser` 包。

## 依赖状态

- ✅ `cron-parser`：已安装，提供 `CronExpression`（解析后类型）和 `CronExpressionParser.parse()`
- ✅ Watcher 解耦重构（`draft/watcher.md`）：**已完成**。`FluxionWatcherBase` + `WatcherCore` 三层架构已实现，CronJobWatcher 可直接继承

## 关键设计决策

### 1. Cronjob 运行在 Primary fork 的专用 worker 进程中

- Primary 通过 `cluster.fork({ FLUXION_WORKER_TYPE: 'cronjob' })` 创建一个专用 worker
- 该 worker 通过 `process.env.FLUXION_WORKER_TYPE === 'cronjob'` 识别自己
- 专用 worker **不启动 HTTP server**，只运行 CronJobManager + CronJobWatcher
- 专用 worker 不纳入 regular worker pool（不参与 healthz ping、不参与路由查询、不参与 restart storm 计数）
- Primary 需要单独管理这个 worker 的生命周期（exit 后 respawn，shutdown 时 kill）
- 避免 N 倍重复执行，同时保持与现有 worker 架构隔离
- 专用 worker 有自己的 CronJobWatcher（监听 cronjobDir）

### 2. 单 tick 循环调度（非每 job 一个 timer）

- 一个 1 秒间隔的 tick 循环检查所有 job
- 每个 job 存储 `nextRunAt: number`（由 `CronExpression.next().getTime()` 计算）
- 每 tick 检查 `Date.now() >= nextRunAt` 来决定是否触发
- 注册时计算首次 nextRunAt，触发后计算下一个
- 注意：cron-parser 的 `CronExpression.next()` 是有状态的迭代器，每次调用会推进到下一个匹配时间
- tick 间隔 1 秒，精度足够且 CPU 开销可忽略

### 3. CronJobWatcher 继承 FluxionWatcherBase

- 继承已有的 `FluxionWatcherBase`（`src/watcher/base.ts`），实现 `onChange()` 方法
- **需要对 `FluxionWatcherBase` 做小幅修改**：构造函数添加可选的 `watchDir` 参数
  - 当前 `FluxionWatcherBase` 在构造函数中硬编码使用 `this.cx.options.dir` 作为监听目录
  - 改为接受可选的 `watchDir: string`，默认值为 `this.cx.options.dir`
  - `init()` 方法也需使用 `this.watchDir` 替代 `this.cx.options.dir`
- CronJobWatcher 传入 `cronjobDir` 作为 `watchDir`
- onChange 逻辑：检查文件存在 → 匹配 cronjobInclude/cronjobExclude → loadFluxionCronJob → manager.reloadModule
- 文件不存在时调用 `manager.unregister()`

### 4. CronJob 文件加载机制

- CronJob 文件通过 `import()` 动态加载（复用现有 API handler 的加载模式）
- CronJob 文件必须 default export `FluxionCronJob` 对象
- 加载后通过 `isFluxionCronJob()` 验证导出结构
- 验证失败时记录错误日志并跳过，不阻断其他文件的加载

### 5. 专用 CronJobContext（非 FluxionContext）

- Cronjob worker 没有 `router` 和 `watcher`（ApiWatcher），因此 jobFn 接收的 context 不是完整的 `FluxionContext`
- 定义独立的 `FluxionCronJobContext` 类型，仅包含 `options` 和 `logger`
- 未来可按需扩展（如添加 database connection pool 等共享资源）

## 核心类型定义

### FluxionCronJob Interface

```typescript
interface FluxionCronJob {
  active?: boolean;                    // 默认 true，可关闭但不注销
  cronExpression: CronExpression;      // cron-parser 的解析后类型（由 defineFluxionCronJob 内部解析）
  jobFn: (cx: FluxionCronJobContext) => void | Promise<void>;
  strategy?: FluxionCronJobExecutionStrategy;  // 默认 WaitForCompletion
  onRegister?: () => void;
  onUnregister?: () => void;
}
```

### CronJob Context

```typescript
interface FluxionCronJobContext {
  options: NormalizedFluxionOptions;
  logger: FluxionLogger;
}
```

### 执行策略 Enum

```typescript
const enum FluxionCronJobExecutionStrategy {
  Immediate = 'immediate',           // 立刻执行，不管上次是否完成
  WaitForCompletion = 'wait',        // 等待上次完成再执行（默认）
}
```

### 内部状态类型

```typescript
interface CronJobState {
  job: FluxionCronJob;
  nextRunAt: number;      // Date.now() 毫秒时间戳
  running: boolean;        // 当前是否在执行（用于 WaitForCompletion 策略）
  modulePath: string;      // 文件绝对路径（用于热重载时重新 import）
}
```

## 文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/cronjob/types.d.ts` | FluxionCronJob interface、Strategy enum、FluxionCronJobContext、CronJobState |
| `src/cronjob/manager.ts` | CronJobManager 类（tick 循环、注册/注销、执行、reloadModule） |
| `src/cronjob/validator.ts` | isFluxionCronJob()、loadFluxionCronJob() |
| `src/defines/cronjob.ts` | defineFluxionCronJob() 辅助函数 |

### 已存在的桩文件（需改写）

| 文件 | 当前状态 | 改写说明 |
|------|----------|----------|
| `src/cronjob/expressions.ts` | 仅有 `EveryMinute` | 扩展为完整表达式集合（见下方） |
| `src/watcher/cronjob-watcher.ts` | 桩实现 + 内联 `CronJobManager` interface（`register(abs, rel): Promise<void>`） | 删除内联 `CronJobManager` interface（改用 `FluxionCronJobManager` 类）；添加 include/exclude 过滤、文件删除检测；`onChange` 调用 `manager.reloadModule()` |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/cronjob/expressions.ts` | 扩展常用表达式（已有 EveryMinute，新增 Every5Minutes、EveryHour 等） |
| `src/types.d.ts` | FluxionOptions 增加 cronjobDir/cronjobInclude/cronjobExclude；NormalizedFluxionOptions 同步 |
| `src/defines/options.ts` | 解构 cronjobDir、cronjobInclude、cronjobExclude，验证并 path.resolve() |
| `src/defines/index.ts` | 导出 defineFluxionCronJob |
| `src/watcher/cronjob-watcher.ts` | 删除内联 `CronJobManager` interface（改用 `FluxionCronJobManager` 类）；添加 include/exclude 过滤、文件删除检测；`onChange` 调用 `manager.reloadModule()` |
| `src/watcher/base.ts` | 构造函数增加可选 `watchDir` 参数，`init()` 使用 `this.watchDir` |
| `src/fluxion.ts` | worker 分支根据 FLUXION_WORKER_TYPE 分流初始化逻辑 |
| `src/cluster/primary.ts` | fork 专用 cronjob worker、管理生命周期（respawn + shutdown kill） |
| `src/cluster/worker.ts` | 新增 initCronJobWorker() 函数，提取公共 shutdown 逻辑 |
| `src/index.ts` | 导出 cronjob 相关类型和函数 |

## 实现细节

### src/cronjob/types.d.ts

```typescript
import type { CronExpression } from 'cron-parser';
import type { NormalizedFluxionOptions } from '@/types.js';
import type { FluxionLogger } from '@/common/logger.js';

/**
 * Context passed to cronjob functions. Lighter than FluxionContext —
 * cronjob workers have no router or ApiWatcher.
 */
export interface FluxionCronJobContext {
  options: NormalizedFluxionOptions;
  logger: FluxionLogger;
}

export const enum FluxionCronJobExecutionStrategy {
  /** Fire immediately regardless of previous run completion. */
  Immediate = 'immediate',
  /** Skip this tick if the previous run is still in progress (default). */
  WaitForCompletion = 'wait',
}

export interface FluxionCronJob {
  active?: boolean;
  cronExpression: CronExpression;
  jobFn: (cx: FluxionCronJobContext) => void | Promise<void>;
  strategy?: FluxionCronJobExecutionStrategy;
  onRegister?: () => void;
  onUnregister?: () => void;
}

/** Internal bookkeeping for each registered job. */
export interface CronJobState {
  job: FluxionCronJob;
  nextRunAt: number;
  running: boolean;
  modulePath: string;
}
```

### src/cronjob/manager.ts

```typescript
import type { FluxionCronJobContext } from './types.js';
import type { FluxionLogger } from '@/common/logger.js';
import type { NormalizedFluxionOptions } from '@/types.js';
import type { FluxionCronJob, CronJobState } from './types.js';
import { FluxionCronJobExecutionStrategy } from './types.js';

const TICK_INTERVAL_MS = 1000;

export class FluxionCronJobManager {
  private readonly jobs = new Map<string, CronJobState>();
  private tickTimer?: NodeJS.Timeout;

  constructor(
    private readonly cx: FluxionCronJobContext,
  ) {}

  /**
   * Register or replace a job for the given filename.
   * If a job already exists under this key, its onUnregister is called first.
   */
  register(filename: string, job: FluxionCronJob, modulePath: string): void {
    const existing = this.jobs.get(filename);
    if (existing) {
      this.callHook(existing.job.onUnregister, filename, 'UnregisterHookFailed');
    }

    const nextRunAt = job.cronExpression.next().getTime();

    this.jobs.set(filename, {
      job,
      nextRunAt,
      running: false,
      modulePath,
    });

    this.cx.logger.info({
      message: 'RegisterCronJob',
      filename,
      nextRunAt: new Date(nextRunAt).toISOString(),
      strategy: job.strategy ?? FluxionCronJobExecutionStrategy.WaitForCompletion,
      active: job.active !== false,
    });

    this.callHook(job.onRegister, filename, 'RegisterHookFailed');
  }

  unregister(filename: string): void {
    const state = this.jobs.get(filename);
    if (!state) return;

    this.callHook(state.job.onUnregister, filename, 'UnregisterHookFailed');
    this.jobs.delete(filename);

    this.cx.logger.info({ message: 'UnregisterCronJob', filename });
  }

  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.tickTimer.unref();
    this.cx.logger.info({ message: 'CronJobManagerStarted', jobCount: this.jobs.size });
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
    this.cx.logger.info({ message: 'CronJobManagerStopped' });
  }

  /**
   * Dynamically reload a cronjob module from disk.
   * Unregisters the old job (if any), imports the new module, validates, and registers.
   * Called by CronJobWatcher on file change.
   */
  async reloadModule(filename: string, absolutePath: string): Promise<void> {
    // 1. Unregister old job
    this.unregister(filename);

    // 2. Dynamic import
    let mod: any;
    try {
      mod = await import(absolutePath);
    } catch (error) {
      this.cx.logger.error({
        message: 'CronJobImportFailed',
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // 3. Validate default export
    const job = mod.default ?? mod;
    if (!isFluxionCronJob(job)) {
      this.cx.logger.error({
        message: 'CronJobValidationFailed',
        filename,
        reason: 'default export is not a valid FluxionCronJob',
      });
      return;
    }

    // 4. Register
    this.register(filename, job, absolutePath);
  }

  private tick(): void {
    const now = Date.now();

    for (const [filename, state] of this.jobs) {
      if (state.job.active === false) continue;
      if (now < state.nextRunAt) continue;

      // Strategy check
      if (
        state.running &&
        (state.job.strategy ?? FluxionCronJobExecutionStrategy.WaitForCompletion) ===
          FluxionCronJobExecutionStrategy.WaitForCompletion
      ) {
        this.cx.logger.warn({ message: 'CronJobSkippedOverlap', filename });
        // Advance past this tick without executing
        state.nextRunAt = state.job.cronExpression.next().getTime();
        continue;
      }

      this.executeJob(filename, state);
    }
  }

  private executeJob(filename: string, state: CronJobState): void {
    state.running = true;

    this.cx.logger.info({ message: 'CronJobStarted', filename });

    const run = async () => {
      try {
        await state.job.jobFn(this.cx);
        this.cx.logger.info({ message: 'CronJobCompleted', filename });
      } catch (error) {
        this.cx.logger.error({
          message: 'CronJobFailed',
          filename,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        state.running = false;
        state.nextRunAt = state.job.cronExpression.next().getTime();
      }
    };

    // Fire and forget — tick loop continues independently
    void run();
  }

  private callHook(hook: (() => void) | undefined, filename: string, errorTag: string): void {
    if (!hook) return;
    try {
      hook();
    } catch (error) {
      this.cx.logger.error({
        message: errorTag,
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
```

**设计说明：**
- `reloadModule()` 由 CronJobWatcher 调用，内部完成 unregister → import → validate → register 全流程
- `executeJob()` 是 fire-and-forget（`void run()`），不阻塞 tick 循环
- `WaitForCompletion` 策略下，若 job 仍在运行，tick 跳过本次并推进 `nextRunAt`
- `Immediate` 策略下，即使上次未完成也会启动新的执行（`state.running` 仍设为 true，但新的 `run()` 并行执行）

### src/cronjob/validator.ts

```typescript
import type { FluxionCronJob } from './types.js';
import type { CronExpression } from 'cron-parser';

/**
 * Type guard: validates that a value conforms to the FluxionCronJob interface.
 */
export function isFluxionCronJob(v: unknown): v is FluxionCronJob {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.jobFn !== 'function') return false;

  // cronExpression must be a cron-parser CronExpression (has .next() and .previous())
  if (
    typeof obj.cronExpression !== 'object' ||
    obj.cronExpression === null ||
    typeof (obj.cronExpression as CronExpression).next !== 'function'
  ) {
    return false;
  }

  // Validate optional fields if present
  if (obj.active !== undefined && typeof obj.active !== 'boolean') return false;
  if (obj.strategy !== undefined && obj.strategy !== 'immediate' && obj.strategy !== 'wait') return false;
  if (obj.onRegister !== undefined && typeof obj.onRegister !== 'function') return false;
  if (obj.onUnregister !== undefined && typeof obj.onUnregister !== 'function') return false;

  return true;
}
```

**设计说明：**
- `isFluxionCronJob()` 是运行时验证（非 TypeScript type guard 编译期），用于动态加载后的结构检查
- `loadFluxionCronJob()` 的完整流程（import + validate）已内联到 `CronJobManager.reloadModule()` 中，不单独拆出

### src/defines/cronjob.ts

```typescript
import { CronExpressionParser } from 'cron-parser';
import type { FluxionCronJob } from '@/cronjob/types.js';
import { FluxionCronJobExecutionStrategy } from '@/cronjob/types.js';

/**
 * Helper to define a FluxionCronJob from a cron expression string.
 * Internally parses the string into a CronExpression via cron-parser.
 *
 * @example
 * ```typescript
 * export default defineFluxionCronJob({
 *   cronExpression: '*/5 * * * *',
 *   jobFn: async (cx) => {
 *     cx.logger.info('Running every 5 minutes');
 *   },
 * });
 * ```
 */
export function defineFluxionCronJob(options: {
  cronExpression: string;
  jobFn: FluxionCronJob['jobFn'];
  active?: boolean;
  strategy?: FluxionCronJobExecutionStrategy;
  onRegister?: () => void;
  onUnregister?: () => void;
}): FluxionCronJob {
  if (typeof options !== 'object' || options === null) {
    $throw('defineFluxionCronJob: options must be an object');
  }
  if (typeof options.cronExpression !== 'string' || options.cronExpression.length === 0) {
    $throw('defineFluxionCronJob: cronExpression must be a non-empty string');
  }
  if (typeof options.jobFn !== 'function') {
    $throw('defineFluxionCronJob: jobFn must be a function');
  }

  let parsed;
  try {
    parsed = CronExpressionParser.parse(options.cronExpression);
  } catch (e) {
    $throw(`defineFluxionCronJob: invalid cron expression "${options.cronExpression}": ${(e as Error).message}`);
  }

  return {
    cronExpression: parsed,
    jobFn: options.jobFn,
    active: options.active,
    strategy: options.strategy,
    onRegister: options.onRegister,
    onUnregister: options.onUnregister,
  };
}
```

### src/cronjob/expressions.ts（扩展）

当前文件仅有 `EveryMinute`，扩展为常用表达式集合：

```typescript
export const enum CronExpressions {
  EveryMinute = '* * * * *',
  Every5Minutes = '*/5 * * * *',
  Every10Minutes = '*/10 * * * *',
  Every15Minutes = '*/15 * * * *',
  Every30Minutes = '*/30 * * * *',
  EveryHour = '0 * * * *',
  Every2Hours = '0 */2 * * *',
  Every6Hours = '0 */6 * * *',
  Every12Hours = '0 */12 * * *',
  EveryDayAtMidnight = '0 0 * * *',
  EveryDayAtNoon = '0 12 * * *',
  EveryMonday = '0 0 * * 1',
  EveryWeek = '0 0 * * 0',
  EveryMonth = '0 0 1 * *',
  EveryYear = '0 0 1 1 *',
}
```

### src/types.d.ts 变更

**FluxionOptions 新增字段：**

```typescript
export interface FluxionOptions {
  // ... 现有字段保持不变 ...

  /**
   * Directory containing cronjob files. When set, the primary forks a
   * dedicated cronjob worker that watches this directory for hot-reloadable
   * scheduled tasks. Set to undefined to disable cronjob support.
   * @default undefined
   */
  cronjobDir?: string;

  /**
   * Glob patterns for cronjob files that should be registered.
   * @default ['**\/*.ts']
   */
  cronjobInclude?: string[];

  /**
   * Glob patterns for cronjob files that should be excluded.
   * @default []
   */
  cronjobExclude?: string[];
}
```

**NormalizedFluxionOptions 新增字段：**

```typescript
export interface NormalizedFluxionOptions {
  // ... 现有字段保持不变 ...

  /** Absolute path to cronjob directory, or undefined if cronjob is disabled. */
  cronjobDir?: string;
  cronjobInclude: string[];
  cronjobExclude: string[];

  // !security check
  normalizedFlag: symbol;
}
```

### src/defines/options.ts 变更

在 `defineFluxionOptions()` 函数中新增解构和验证：

```typescript
const {
  // ... 现有解构 ...
  cronjobDir: rawCronjobDir,
  cronjobInclude = ['**/*.ts'],
  cronjobExclude = [],
} = o as FluxionOptions;

// cronjobDir 验证
let cronjobDir: string | undefined;
if (rawCronjobDir !== undefined) {
  if (typeof rawCronjobDir !== 'string') {
    $throw('FluxionOptions.cronjobDir must be a string');
  }
  cronjobDir = path.resolve(rawCronjobDir);
}
```

在返回对象中新增：

```typescript
return {
  // ... 现有字段 ...
  cronjobDir,
  cronjobInclude,
  cronjobExclude,
  // !
  normalizedFlag: OPTIONS_NORMALIZED_FLAG,
};
```

### src/watcher/base.ts 变更

当前 `FluxionWatcherBase` 在构造函数中硬编码使用 `this.cx.options.dir` 作为监听目录。CronJobWatcher 需要监听不同的目录（`cronjobDir`），因此需要添加可选的 `watchDir` 参数。

**构造函数变更：**

```typescript
export abstract class FluxionWatcherBase {
  protected readonly cx: WatcherBaseContext;
  protected readonly watchDir: string;   // 新增
  private readonly core: WatcherCore;

  constructor(
    cx: WatcherBaseContext,
    CoreType: WatcherCoreConstructor,
    watchDir?: string,    // 新增：可选的监听目录，默认为 cx.options.dir
  ) {
    this.cx = cx;
    this.watchDir = watchDir ?? cx.options.dir;  // 新增

    this.core = new CoreType({
      dir: this.watchDir,   // 改为使用 this.watchDir（原为 this.cx.options.dir）
      onFileChanged: (absolutePath: string, relativePath: string) => this.queueUp(absolutePath, relativePath),
      onError: (error: Error) => {
        this.cx.logger.error(`Watcher error: ${error.message}`);
        this.cx.logger.error(`Restarting watcher...`);
        this.start();
      },
      onReady: () => {
        this.cx.logger.info(`Watcher ready and watching directory: ${this.watchDir}`);  // 改为 this.watchDir
      },
    });
  }
  // ...
}
```

**`init()` 方法变更：**

```typescript
protected async init(): Promise<this> {
  const dir = this.watchDir;  // 改为使用 this.watchDir（原为 this.cx.options.dir）
  if (!fs.existsSync(dir)) {
    this.cx.logger.warn(`Directory does not exist: ${dir}`);
    return this;
  }
  // ... 其余逻辑不变 ...
}
```

**影响范围：** `ApiWatcher` 无需修改（不传 watchDir，默认使用 `cx.options.dir`，行为不变）。

### src/cluster/primary.ts 变更

在 `FluxionPrimaryController` 中添加 cronjob worker 管理：

**新增成员：**

```typescript
class FluxionPrimaryController {
  // ... 现有成员 ...
  private cronjobWorker: cluster.Worker | null = null;
  // ...
}
```

**`start()` 方法末尾新增 cronjob worker fork：**

```typescript
async start(): Promise<void> {
  // ... 现有逻辑（launchFluxionInstance、spawn workers、startPingLoop）...

  if (this.cx.options.cronjobDir) {
    this.spawnCronjobWorker();
  }
}
```

**新增 `spawnCronjobWorker()` 和 `attachCronjobWorker()` 方法：**

```typescript
private spawnCronjobWorker(): void {
  if (this.shuttingDown) return;

  const worker = cluster.fork({ FLUXION_WORKER_TYPE: 'cronjob' });
  this.attachCronjobWorker(worker);
}

private attachCronjobWorker(worker: cluster.Worker): void {
  this.cronjobWorker = worker;

  worker.on('message', (raw: WorkerMessage) => {
    if (!isWorkerMessage(raw)) return;

    if (raw.type === WorkerAction.Created) {
      this.cx.logger.info({
        message: 'CronjobWorkerCreated',
        pid: raw.pid,
      });
      return;
    }

    if (raw.type === WorkerAction.Ready) {
      this.cx.logger.info({
        message: 'CronjobWorkerReady',
        pid: raw.pid,
      });
    }
  });

  worker.on('exit', (code, signal) => {
    this.cx.logger.warn({
      message: 'CronjobWorkerExited',
      pid: worker.process.pid ?? 'unknown',
      code,
      signal: signal ?? 'none',
      expected: this.shuttingDown,
    });

    if (this.shuttingDown) return;

    // Auto-respawn（无 restart storm 检测）
    this.cx.logger.info({ message: 'CronjobWorkerRespawning' });
    this.spawnCronjobWorker();
  });
}
```

**`shutdownWorkers()` 中新增 cronjob worker kill：**

在现有 shutdown 流程中，向所有 worker 发送 kill signal 后，也需要 kill cronjob worker：

```typescript
private async shutdownWorkers(signal: NodeJS.Signals): Promise<void> {
  // 现有：kill regular workers ...

  // 新增：kill cronjob worker
  if (this.cronjobWorker && !this.cronjobWorker.isDead()) {
    this.cx.logger.warn({
      message: 'CronjobWorkerShutdownRequested',
      pid: this.cronjobWorker.process.pid ?? null,
      signal,
    });
    try {
      this.cronjobWorker.kill(signal);
    } catch {
      // Ignore races; exit listener will reconcile state.
    }
  }

  // ... 现有的 waitForWorkersToExit + forceKill ...
}
```

**注意事项：**
- Cronjob worker 不参与 `startPingLoop()`（不发 Ping，不检测 healthzTimeout）
- Cronjob worker 不参与 `evaluateResourceConditions()`（不做内存/uptime 回收）
- Cronjob worker 不参与 restart storm 检测（无 `MAX_RESTARTS_PER_WINDOW` 限制）
- Cronjob worker 不参与 `getRoutesSnapshot()`（无 router）

### src/cluster/worker.ts 变更

**新增 `initCronJobWorker()` 函数：**

```typescript
import { FluxionCronJobManager } from '@/cronjob/manager.js';
import { CronJobWatcher } from '@/watcher/cronjob-watcher.js';
import { FluxionChokidarCore, FluxionNativeCore } from '@/watcher/core.js';
import { getErrorMessage } from '@/common/logger.js';

const CRONJOB_SHUTDOWN_TIMEOUT_MS = 30_000; // cronjob 可能需要更长的关闭时间

function initCronJobWorker(cx: FluxionContext): void {
  const cronjobCx = {
    options: cx.options,
    logger: cx.logger,
  };

  const manager = new FluxionCronJobManager(cronjobCx);
  const CoreType = cx.options.nativeWatcher ? FluxionNativeCore : FluxionChokidarCore;
  const watcher = new CronJobWatcher(
    { ...cronjobCx, cronJobManager: manager },
    CoreType,
  );

  // 启动流程：先扫描目录注册所有 cronjob，再启动 tick 循环和文件监听
  watcher.start().then(() => {
    manager.start();
    process.send?.({ type: WorkerAction.Ready, pid: process.pid });
  }).catch((error) => {
    cx.logger.error({
      message: 'CronJobWorkerBootstrapFailed',
      error: getErrorMessage(error),
    });
    process.exit(1);
  });

  // 信号处理
  let exiting = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (exiting) return;
    exiting = true;

    cx.logger.warn({ message: 'CronJobWorkerShuttingDown', pid: process.pid, signal });
    watcher.stop();
    manager.stop();

    // 等待正在执行的 job 完成（最多 CRONJOB_SHUTDOWN_TIMEOUT_MS）
    const deadline = Date.now() + CRONJOB_SHUTDOWN_TIMEOUT_MS;
    while (Date.now() < deadline && manager.hasRunningJobs()) {
      await new Promise((r) => setTimeout(r, 200));
    }

    if (manager.hasRunningJobs()) {
      cx.logger.warn({ message: 'CronJobWorkerForceExit', pid: process.pid });
    }

    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}
```

**需要在 `FluxionCronJobManager` 中新增 `hasRunningJobs()` 方法：**

```typescript
hasRunningJobs(): boolean {
  for (const state of this.jobs.values()) {
    if (state.running) return true;
  }
  return false;
}
```

**`initWorker()` 中新增分流逻辑：**

```typescript
export function initWorker(cx: FluxionContext) {
  if (cluster.isPrimary) {
    $throw('createWorker should only be called in worker process');
  }

  if (process.env.FLUXION_WORKER_TYPE === 'cronjob') {
    initCronJobWorker(cx);
  } else {
    new FluxionWorkerRuntime(cx).start();
  }
}
```

### src/fluxion.ts 变更

在 worker 分支中，cronjob worker 不需要 ApiWatcher 和 Router：

```typescript
export async function fluxion(options: FluxionOptions | NormalizedFluxionOptions) {
  const alreadyNormalized = (options as NormalizedFluxionOptions).normalizedFlag === OPTIONS_NORMALIZED_FLAG;
  const context = { options: alreadyNormalized ? options : defineFluxionOptions(options) } as FluxionContext;

  context.logger = createLogger(context as Pick<FluxionContext, 'options'>);

  if (cluster.isPrimary) {
    context.router = new FluxionRouter(context as Pick<FluxionContext, 'options' | 'logger'>);
    await initPrimary(context);
  } else if (process.env.FLUXION_WORKER_TYPE === 'cronjob') {
    // Cronjob worker: 无 router、无 ApiWatcher
    context.logger = createWorkerLogger(context.logger, process.pid);
    initWorker(context);
  } else {
    // Regular HTTP worker
    context.router = new FluxionRouter(context as Pick<FluxionContext, 'options' | 'logger'>);
    context.logger = createWorkerLogger(context.logger, process.pid);
    const CoreType = context.options.nativeWatcher ? FluxionNativeCore : FluxionChokidarCore;
    context.watcher = await new ApiWatcher(
      context as Pick<FluxionContext, 'options' | 'logger' | 'router'>,
      CoreType,
    ).start();
    initWorker(context);
  }
}
```

### src/watcher/cronjob-watcher.ts（新增文件）

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { FluxionWatcherBase, type WatcherBaseContext, type WatcherCoreConstructor } from './base.js';
import type { FluxionCronJobManager } from '@/cronjob/manager.js';

export interface CronJobWatcherContext extends WatcherBaseContext {
  cronJobManager: FluxionCronJobManager;
}

/**
 * Watches the cronjob directory and hot-reloads jobs on file changes.
 */
export class CronJobWatcher extends FluxionWatcherBase {
  private readonly manager: FluxionCronJobManager;
  private readonly include: string[];
  private readonly exclude: string[];

  constructor(cx: CronJobWatcherContext, CoreType: WatcherCoreConstructor) {
    super(cx, CoreType, cx.options.cronjobDir);
    this.manager = cx.cronJobManager;
    this.include = cx.options.cronjobInclude;
    this.exclude = cx.options.cronjobExclude;
  }

  async onChange(absolutePath: string, relativePath: string): Promise<void> {
    // File deleted → unregister
    if (!fs.existsSync(absolutePath)) {
      this.manager.unregister(relativePath);
      return;
    }

    // Include/exclude filter
    if (!this.matchesPatterns(relativePath)) {
      return;
    }

    // Reload (import + validate + register)
    await this.manager.reloadModule(relativePath, absolutePath);
  }

  private matchesPatterns(relativePath: string): boolean {
    const included = this.include.some((pattern) => minimatch(relativePath, pattern));
    if (!included) return false;

    const excluded = this.exclude.some((pattern) => minimatch(relativePath, pattern));
    return !excluded;
  }
}
```

### src/index.ts 变更

```typescript
// 新增 cronjob 导出
export { defineFluxionCronJob } from './defines/cronjob.js';
export { FluxionCronJobExecutionStrategy } from './cronjob/types.js';
export type { FluxionCronJob, FluxionCronJobContext } from './cronjob/types.js';
export { CronExpressions } from './cronjob/expressions.js';
```

### src/defines/index.ts 变更

```typescript
// 新增导出
export { defineFluxionCronJob } from './cronjob.js';
```

## CronJob 文件示例

```typescript
// my-cronjobs/cleanup.ts
import { defineFluxionCronJob, CronExpressions } from 'fluxion';

export default defineFluxionCronJob({
  cronExpression: CronExpressions.Every5Minutes,
  async jobFn(cx) {
    cx.logger.info('Running cleanup task...');
    // ... 业务逻辑 ...
  },
});
```

```typescript
// my-cronjobs/report.ts
import { defineFluxionCronJob, FluxionCronJobExecutionStrategy } from 'fluxion';

export default defineFluxionCronJob({
  cronExpression: '0 9 * * 1',  // Every Monday 9am
  strategy: FluxionCronJobExecutionStrategy.WaitForCompletion,
  onRegister() {
    console.log('Report job registered');
  },
  async jobFn(cx) {
    cx.logger.info('Generating weekly report...');
    // ... 生成报告 ...
  },
});
```

## 日志事件汇总

| 事件 | 级别 | 来源 | 说明 |
|------|------|------|------|
| `RegisterCronJob` | info | Manager | CronJob 注册成功 |
| `UnregisterCronJob` | info | Manager | CronJob 注销 |
| `CronJobManagerStarted` | info | Manager | Manager tick 循环启动 |
| `CronJobManagerStopped` | info | Manager | Manager tick 循环停止 |
| `CronJobStarted` | info | Manager | 单次 Job 开始执行 |
| `CronJobCompleted` | info | Manager | 单次 Job 执行成功 |
| `CronJobFailed` | error | Manager | 单次 Job 执行失败 |
| `CronJobSkippedOverlap` | warn | Manager | WaitForCompletion 策略下跳过重叠执行 |
| `CronJobImportFailed` | error | Manager | 动态 import 失败 |
| `CronJobValidationFailed` | error | Manager | 导出结构验证失败 |
| `RegisterHookFailed` | error | Manager | onRegister 回调抛出异常 |
| `UnregisterHookFailed` | error | Manager | onUnregister 回调抛出异常 |
| `CronjobWorkerCreated` | info | Primary | Cronjob worker 进程创建 |
| `CronjobWorkerReady` | info | Primary | Cronjob worker 就绪 |
| `CronjobWorkerExited` | warn | Primary | Cronjob worker 退出 |
| `CronjobWorkerRespawning` | info | Primary | Cronjob worker 自动重启 |
| `CronjobWorkerShutdownRequested` | warn | Primary | Shutdown 中请求 kill cronjob worker |
| `CronJobWorkerBootstrapFailed` | error | Worker | Cronjob worker 初始化失败 |
| `CronJobWorkerShuttingDown` | warn | Worker | Cronjob worker 收到 shutdown 信号 |
| `CronJobWorkerForceExit` | warn | Worker | 等待超时强制退出 |

## 验证方式

1. 创建测试 cronjobDir，写一个每分钟执行的 cronjob 文件
2. 启动 fluxion 实例（`cronjobDir` 指向测试目录），确认 primary 日志中出现 `CronjobWorkerCreated` → `CronjobWorkerReady`
3. 确认 worker 日志中出现 `CronJobManagerStarted`
4. 等待触发，确认日志中出现 `CronJobStarted` → `CronJobCompleted`
5. 修改 cronjob 文件，确认 `RegisterCronJob` 日志（热重载生效）
6. 删除文件，确认 `UnregisterCronJob` 日志
7. 测试 `active: false` 的 job 不触发（无 `CronJobStarted` 日志）
8. 测试 `Immediate` strategy 允许重叠执行（同时出现多个 `CronJobStarted`）
9. 测试 `WaitForCompletion` strategy 跳过重叠（出现 `CronJobSkippedOverlap`）
10. kill 专用 worker，确认 primary 自动 respawn（`CronjobWorkerRespawning` → `CronjobWorkerReady`）
11. Ctrl+C shutdown，确认 cronjob worker 被正常关闭

## 注意事项

### 时钟精度
- tick 间隔 1 秒，cron 精度到分钟级别，不会错过任何分钟
- 系统休眠/挂起后 `Date.now()` 可能跳过多个 tick，恢复后不会追溯执行错过的 job
- `nextRunAt` 由 cron-parser 计算，始终指向未来的下一个匹配时间

### 热重载交互
- 文件变更时 CronJobWatcher 触发 `onChange()`
- `onChange()` 调用 `manager.reloadModule()`：unregister 旧 job → dynamic import 新文件 → validate → register 新 job
- Register 时重新计算 `nextRunAt`（基于新的 cronExpression）
- 正在执行的旧 job 不受影响（fire-and-forget 模式），完成后自然结束

### 进程管理
- Cronjob worker 与 regular worker 使用相同的 IPC 通道，但消息类型独立
- Cronjob worker 不发 Pong/Stats/Routes，Primary 不对其做 healthz 检测
- Cronjob worker 崩溃后 Primary 自动 respawn（无 storm 检测限制）
- Shutdown 时 Primary 向 cronjob worker 发送 kill signal，等待退出

### 生产部署
- 生产环境 cronjob 文件应为编译后的 `.js` 文件
- 如需 TypeScript 支持，需确保 worker 进程有 tsx/ts-node loader
- `cronjobDir` 不设置（undefined）时完全禁用 cronjob 功能，Primary 不 fork cronjob worker
