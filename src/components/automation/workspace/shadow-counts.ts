import type { Counts, Data } from '../presentation-types';

export const emptyCounts: Counts = {
  evaluated: 0,
  same: 0,
  routes: 0,
  priorities: 0,
  skips: 0,
  errors: 0,
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
        evaluated: sum.evaluated + row.evaluated,
        same: sum.same + row.same,
        routes: sum.routes + row.routeDifferent,
        priorities: sum.priorities + row.priorityDifferent,
        skips: sum.skips + row.noEscalationDifferent,
        errors: sum.errors + row.errors,
      }),
      emptyCounts
    );
}
