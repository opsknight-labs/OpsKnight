/**
 * "Why did this change" for analytics cards: an exact, deterministic decomposition of a period-over-period
 * change into per-service contributions. Pure; the loader feeds it daily rollup sums.
 */

export const CHANGE_METRICS = ['incidents', 'mtta', 'mttr'] as const;
export type ChangeMetric = (typeof CHANGE_METRICS)[number];

/** One service's rollup sums for one period. Durations are milliseconds. */
export interface ServicePeriod {
  count: number;
  ackSum: number;
  ackCount: number;
  resolveSum: number;
  resolveCount: number;
}

export interface ChangeContributor {
  serviceId: string;
  /** This service's share of the change: incidents, or minutes of the mean for MTTA/MTTR. */
  delta: number;
}

export interface MetricChange {
  metric: ChangeMetric;
  direction: 'up' | 'down';
  /** Whole-period values the decomposition explains (incidents, or mean minutes). */
  current: number;
  previous: number;
  contributors: ChangeContributor[];
  /** Fraction of the change the listed contributors account for (can exceed 1 when others offset it). */
  share: number;
}

export const METRIC_CHANGE_LIMITS = { contributors: 3 } as const;

const MINUTE_MS = 60_000;
const EMPTY: ServicePeriod = { count: 0, ackSum: 0, ackCount: 0, resolveSum: 0, resolveCount: 0 };

const totals = (periods: ReadonlyMap<string, ServicePeriod>) => {
  const sum = { ...EMPTY };
  for (const p of periods.values()) {
    sum.count += p.count;
    sum.ackSum += p.ackSum;
    sum.ackCount += p.ackCount;
    sum.resolveSum += p.resolveSum;
    sum.resolveCount += p.resolveCount;
  }
  return sum;
};

const formatDelta = (metric: ChangeMetric, delta: number) => {
  const sign = delta > 0 ? '+' : '−';
  const size = Math.abs(delta);
  if (metric === 'incidents') return `${sign}${Math.round(size)}`;
  return size >= 90
    ? `${sign}${(size / 60).toFixed(1)}h`
    : `${sign}${Math.max(1, Math.round(size))}m`;
};

/**
 * Splits the change in `metric` between `previous` and `current` into per-service terms that add up to the
 * whole change exactly: a count difference per service, or for a mean (MTTA/MTTR)
 * `sum_i(current)/n(current) − sum_i(previous)/n(previous)`. Returns the services that moved the metric in
 * the direction it went, largest first, or null when there is nothing to explain. The caller passes only
 * services the viewer may read, so totals and contributors match what the viewer's card shows.
 */
export function explainMetricChange(
  metric: ChangeMetric,
  current: ReadonlyMap<string, ServicePeriod>,
  previous: ReadonlyMap<string, ServicePeriod>
): MetricChange | null {
  const now = totals(current);
  const before = totals(previous);
  const pick = (p: ServicePeriod) =>
    metric === 'mtta' ? [p.ackSum, p.ackCount] : [p.resolveSum, p.resolveCount];
  let currentValue: number;
  let previousValue: number;
  let term: (id: string) => number;
  if (metric === 'incidents') {
    currentValue = now.count;
    previousValue = before.count;
    term = id => (current.get(id)?.count ?? 0) - (previous.get(id)?.count ?? 0);
  } else {
    const [, n1] = pick(now);
    const [, n0] = pick(before);
    if (n1 === 0 || n0 === 0) return null;
    currentValue = pick(now)[0] / n1 / MINUTE_MS;
    previousValue = pick(before)[0] / n0 / MINUTE_MS;
    term = id =>
      (pick(current.get(id) ?? EMPTY)[0] / n1 - pick(previous.get(id) ?? EMPTY)[0] / n0) /
      MINUTE_MS;
  }
  const change = currentValue - previousValue;
  if (change === 0 || !Number.isFinite(change)) return null;

  const contributors = [...new Set([...current.keys(), ...previous.keys()])]
    .map(id => ({ serviceId: id, delta: term(id) }))
    .filter(c => Math.sign(c.delta) === Math.sign(change))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.serviceId.localeCompare(b.serviceId))
    .slice(0, METRIC_CHANGE_LIMITS.contributors);
  if (contributors.length === 0) return null;
  return {
    metric,
    direction: change > 0 ? 'up' : 'down',
    current: currentValue,
    previous: previousValue,
    contributors,
    share: contributors.reduce((sum, c) => sum + c.delta, 0) / change,
  };
}

/** The one line shown under the card, for example "Most of the rise: payments +12, checkout +5". */
export function describeMetricChange(
  change: MetricChange,
  names: ReadonlyMap<string, string>
): string {
  const listed = change.contributors
    .map(
      c => `${names.get(c.serviceId) ?? 'a removed service'} ${formatDelta(change.metric, c.delta)}`
    )
    .join(', ');
  if (change.share < 0.5) return `Spread across services; largest: ${listed}`;
  return `${change.direction === 'up' ? 'Most of the rise' : 'Most of the drop'}: ${listed}`;
}
