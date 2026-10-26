/** A prior period is only comparable when it holds a meaningful share of the current volume. */
export const MIN_PRIOR_INCIDENTS = 10;
export const MIN_PRIOR_VOLUME_RATIO = 0.25;

export function isComparablePriorPeriod(currentTotal: number, priorTotal: number): boolean {
  if (priorTotal < MIN_PRIOR_INCIDENTS) return false;
  return priorTotal >= currentTotal * MIN_PRIOR_VOLUME_RATIO;
}
