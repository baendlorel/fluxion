# Cronjob 功能实现计划

## 背景

为 fluxion-ts 添加 cronjob 功能，支持热重载。用户已安装 `cron-parser` 包。

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

### 3. CronJobWatcher 继承解耦后的 WatcherBase

- 依赖 watcher 解耦重构（见 `draft/watcher.md`）
- 继承 `FluxionWatcherBase`，实现 `onChange()` 方法
- onChange 逻辑：检查文件存在 → 匹配 include/exclude → loadFluxionCronJob → manager.register

## 核心类型定义

### FluxionCronJob Interface

```typescript
interface FluxionCronJob {
  active?: boolean;                    // 默认 true，可关闭但不注销
  cronExpression: CronExpression;      // cron-parser 的解析后类型
  jobFn: (cx: FluxionContext) => void | Promise<void>;
  strategy?: FluxionCronJobExecutionStrategy;  // 默认 WaitForCompletion
  onRegister?: () => void;
  onUnregister?: () => void;
}
```

### 执行策略 Enum

```typescript
enum FluxionCronJobExecutionStrategy {
  Immediate = 'immediate',           // 立刻执行，不管上次是否完成
  WaitForCompletion = 'wait',        // 等待上次完成再执行（默认）
}
```

## 文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/cronjob/types.d.ts` | FluxionCronJob interface、Strategy enum、Meta interface |
| `src/cronjob/manager.ts` | CronJobManager 类（tick 循环、注册/注销、执行） |
| `src/cronjob/validator.ts` | isFluxionCronJob()、loadFluxionCronJob() |
| `src/defines/cronjob.ts` | defineFluxionCronJob() 辅助函数 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/cronjob/expressions.ts` | 扩展常用表达式（Every5Minutes、EveryHour、EveryDay 等） |
| `src/types.d.ts` | FluxionOptions 增加 cronjobDir、FluxionContext 增加 cronJobManager |
| `src/defines/options.ts` | 解构 cronjobDir，验证为 string，path.resolve() |
| `src/defines/index.ts` | 导出 defineFluxionCronJob |
| `src/fluxion.ts` | 根据 FLUXION_WORKER_TYPE 分流初始化逻辑 |
| `src/cluster/primary.ts` | fork 专用 worker、管理生命周期、shutdown 时 kill |
| `src/cluster/worker.ts` | 新增 initCronJobWorker() 函数 |
| `src/index.ts` | 导出 cronjob 相关类型和函数 |

## 实现细节

### CronJobManager

```typescript
class FluxionCronJobManager {
  private jobs: Map<string, CronJobState> = new Map();
  private tickTimer?: NodeJS.Timeout;

  register(filename: string, job: FluxionCronJob): void {
    // 调用旧 job 的 onUnregister
    // 存储新 job
    // 计算 nextRunAt = expression.next().getTime()
    // 调用 onRegister
  }

  unregister(filename: string): void {
    // 调用 onUnregister
    // 从 Map 删除
  }

  start(): void {
    // 启动 1 秒 tick 循环
  }

  stop(): void {
    // 停止循环
  }

  private tick(): void {
    // 遍历 jobs
    // 检查 Date.now() >= nextRunAt
    // 按 strategy 决定是否执行
    // 执行后计算下一个 nextRunAt
  }
}
```

### defineFluxionCronJob

```typescript
function defineFluxionCronJob(options: {
  cronExpression: string;
  jobFn: FluxionCronJob['jobFn'];
  active?: boolean;
  strategy?: FluxionCronJobExecutionStrategy;
  onRegister?: () => void;
  onUnregister?: () => void;
}): FluxionCronJob {
  // 内部用 CronExpressionParser.parse() 解析字符串为 CronExpression
  // 返回存储解析后的 CronExpression
}
```

### Primary 管理专用 worker

```typescript
// start() 中
if (cronjobDir) {
  this.cronjobWorker = cluster.fork({ FLUXION_WORKER_TYPE: 'cronjob' });
  // 监听 exit 事件，respawn
}

// beginShutdown() 中
if (this.cronjobWorker) {
  this.cronjobWorker.kill();
}
```

### Worker 分流

```typescript
// fluxion.ts 或 worker.ts 中
if (process.env.FLUXION_WORKER_TYPE === 'cronjob') {
  initCronJobWorker(context);  // 创建 manager + watcher，不启动 HTTP server
} else {
  initHttpWorker(context);     // 原有逻辑
}
```

## 常用 Cron 表达式

```typescript
enum CronExpressions {
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

## 验证方式

1. 创建测试 cronjobDir，写一个每分钟执行的 cronjob 文件
2. 启动 fluxion 实例，确认专用 worker 日志中出现 CronJobManager started
3. 等待触发，确认日志中出现 CronJobStarted/CronJobCompleted
4. 修改 cronjob 文件，确认热重载生效（RegisterCronJob 日志）
5. 删除文件，确认 UnregisterCronJob 日志
6. 测试 `active: false` 的 job 不触发
7. 测试 `Immediate` strategy 允许重叠执行
8. kill 专用 worker，确认 primary 自动 respawn

## 依赖

- watcher 解耦重构（`draft/watcher.md`）：CronJobWatcher 需要继承解耦后的 WatcherBase
