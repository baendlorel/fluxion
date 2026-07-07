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
