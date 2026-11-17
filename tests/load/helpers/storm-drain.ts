/**
 * The storm benchmark's drain loop (tests/load/intelligence-storm.ts), shared by the in-process run and
 * the lane-thread run (helpers/intelligence-storm-thread-entry.ts) so both measure exactly the same loop.
 */
import { performance } from 'node:perf_hooks';
import prisma from '../../../src/lib/prisma';
import {
  DEFAULT_HANDLERS,
  createLaneState,
  runIntelligenceCycle,
  type WorkHandlers,
} from '../../../src/lib/intelligence/jobs/runner';
import type { WorkKind } from '../../../src/lib/intelligence/jobs/work-queue';

function timed(samples: Map<string, number[]>): WorkHandlers {
  return Object.fromEntries(
    Object.entries(DEFAULT_HANDLERS).map(([kind, handler]) => [
      kind,
      async (...args: Parameters<NonNullable<WorkHandlers[WorkKind]>>) => {
        const started = performance.now();
        try {
          await handler!(...args);
        } finally {
          const list = samples.get(kind) ?? [];
          list.push(performance.now() - started);
          samples.set(kind, list);
        }
      },
    ])
  ) as WorkHandlers;
}

export interface DrainResult {
  drainSeconds: number;
  cycles: number;
  failed: number;
  /** Handler durations in milliseconds, by work kind. */
  samples: Array<[string, number[]]>;
}

/** Runs lane cycles back to back, periodic sweeps held off, until the queue is empty. */
export async function drainQueue(): Promise<DrainResult> {
  const samples = new Map<string, number[]>();
  const handlers = timed(samples);
  const state = createLaneState();
  const holdSweeps = () =>
    Object.assign(state, {
      lastReconcileAt: Date.now(),
      lastUpdatedRepairAt: Date.now(),
      lastRetentionAt: Date.now(),
      lastObserveAt: Date.now(),
      lastEmbedAt: Date.now(),
      lastDigestCheckAt: Date.now(),
    });
  holdSweeps();
  const started = performance.now();
  let cycles = 0;
  let failed = 0;
  for (;;) {
    // A 1M-history run can exceed a sweep interval. Keep sweeps disabled on every cycle so
    // this benchmark continues to measure the queued burst rather than a history backfill.
    holdSweeps();
    const result = await runIntelligenceCycle(state, { handlers, getCriticalLagMs: async () => 0 });
    cycles += 1;
    failed += result.failed;
    if (
      result.claimed === 0 &&
      (await prisma.intelligenceWorkItem.count({ where: { attempts: { lt: 8 } } })) === 0
    )
      break;
  }
  return {
    drainSeconds: (performance.now() - started) / 1000,
    cycles,
    failed,
    samples: [...samples.entries()],
  };
}
