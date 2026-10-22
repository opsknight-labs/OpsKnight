import type { Counts, Data } from '../presentation-types';

export const emptyCounts: Counts = {
  evaluated: 0,
  same: 0,
  routes: 0,
  priorities: 0,
  skips: 0,
  errors: 0,
  fallbacks: 0,
};

/** Sums seven-day Shadow aggregates, optionally limited to one published version. */
export function sumShadowAggregates(
  rows: Data['aggregates'] | undefined,
  versionId?: string | null
): Counts | undefined {
  if (!rows) return undefined;
  return rows
    .filter(row => versionId === undefined || row.versionId === versionId)
    .reduce(
      (sum, row) => ({
        evaluated: sum.evaluated + (row.evaluated ?? 0),
        same: sum.same + (row.same ?? 0),
        routes: sum.routes + (row.routeDifferent ?? 0),
        priorities: sum.priorities + (row.priorityDifferent ?? 0),
        skips: sum.skips + (row.noEscalationDifferent ?? 0),
        errors: sum.errors + (row.errors ?? 0),
        fallbacks: sum.fallbacks + (row.fallbacks ?? 0),
      }),
      emptyCounts
    );
}

/**
 * Calculates the deduplicated count of failed evaluations from errors and fallbacks.
 * Because runtime errors during shadow execution trigger fallbacks (as observed in
 * `src/lib/automation/runtime.ts`), individual failure events increment both the error
 * and fallback counters. Deduplicating by taking the maximum avoids inflating failure
 * metrics (e.g., 3 failed evaluations appearing as 6 failures).
 */
export function calculateDeduplicatedFailures(errors: number = 0, fallbacks: number = 0): number {
  return Math.max(errors, fallbacks);
}
