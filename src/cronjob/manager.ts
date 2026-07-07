import type { FluxionCronJobContext } from './types.js';
import type { FluxionCronJob, CronJobState } from './types.js';
import { FluxionCronJobExecutionStrategy } from './types.js';
import { isFluxionCronJob } from './validator.js';

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

  hasRunningJobs(): boolean {
    for (const state of this.jobs.values()) {
      if (state.running) return true;
    }
    return false;
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
