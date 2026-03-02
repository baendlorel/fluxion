import type { FluxionLogger } from '@/common/logger.js';
import { createHandlerWorkerPool } from '@/workers/handler-worker-pool.js';

import type { FileRuntimeOptions, WorkerBinding } from './index.js';

/**
 * Default runtime worker id.
 */
const DEFAULT_WORKER_ID = 'fluxion-worker-all';

/**
 * Creates runtime worker bindings from current runtime options.
 */
export function createWorkerBindings(options: FileRuntimeOptions, logger: FluxionLogger): WorkerBinding[] {
  return [
    {
      id: DEFAULT_WORKER_ID,
      pool: createHandlerWorkerPool({
        meta: {
          id: DEFAULT_WORKER_ID,
          dbSet: [],
          isFallbackAllDb: false,
        },
        overrides: options.workerOptions,
        logger,
      }),
    },
  ];
}

/**
 * Picks the best execution worker by current load and stable id tie-break.
 */
export function selectExecutionWorker(workers: readonly WorkerBinding[]): WorkerBinding {
  if (workers.length === 0) {
    throw new Error('No worker can handle request');
  }

  let best = workers[0];
  let bestInflight = best.pool.getSnapshot().inflight;

  for (let i = 1; i < workers.length; i++) {
    const candidate = workers[i];
    const candidateInflight = candidate.pool.getSnapshot().inflight;

    if (candidateInflight < bestInflight) {
      best = candidate;
      bestInflight = candidateInflight;
      continue;
    }

    if (candidateInflight === bestInflight && candidate.id.localeCompare(best.id) < 0) {
      best = candidate;
      bestInflight = candidateInflight;
    }
  }

  return best;
}
