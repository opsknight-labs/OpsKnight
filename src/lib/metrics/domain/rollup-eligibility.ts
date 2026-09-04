import type { IncidentMetricFilter } from './filter';

/**
 * Daily rollups may only answer filters whose complete metric dimensions are
 * persisted in the rollup schema. A filter is intentionally routed to the
 * exact live path when rollups could answer only a subset of the metric
 * contract; correct-but-slower is preferable to publishing synthetic zeros.
 */
export function isRollupCompatibleIncidentFilter(filter: IncidentMetricFilter): boolean {
  return !(
    filter.teamId !== undefined ||
    filter.authorizationScope !== undefined ||
    filter.priority !== undefined ||
    filter.urgency !== undefined ||
    filter.assigneeId !== undefined ||
    filter.status !== undefined ||
    (filter.visibility !== undefined && filter.visibility !== 'ALL')
  );
}
