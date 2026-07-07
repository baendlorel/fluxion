import type { CronExpression } from 'cron-parser';
import type { FluxionCronJob } from './types.js';

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
