import { CronExpressionParser } from 'cron-parser';
import type { FluxionCronJob } from '@/cronjob/types.js';
import { FluxionCronJobExecutionStrategy } from '@/cronjob/types.js';

/**
 * Helper to define a FluxionCronJob from a cron expression string.
 * Internally parses the string into a CronExpression via cron-parser.
 *
 * @example
 * export default defineFluxionCronJob({
 *   cronExpression: '0 0 * * *',
 *   jobFn: async (cx) => {
 *     cx.logger.info('Running every day at midnight');
 *   },
 * });
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
    _throw('defineFluxionCronJob: options must be an object');
  }
  if (typeof options.cronExpression !== 'string' || options.cronExpression.length === 0) {
    _throw('defineFluxionCronJob: cronExpression must be a non-empty string');
  }
  if (typeof options.jobFn !== 'function') {
    _throw('defineFluxionCronJob: jobFn must be a function');
  }

  let parsed;
  try {
    parsed = CronExpressionParser.parse(options.cronExpression);
  } catch (e) {
    _throw(`defineFluxionCronJob: invalid cron expression "${options.cronExpression}": ${(e as Error).message}`);
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
