/**
 * A labelled alert storm for the correlation engine. Each incident carries the label of the real problem it
 * belongs to; incidents that must stay alone (a one-off, the same text on another service, the same text an
 * hour later, a page-immediately incident) have their own label. The integration test
 * (`tests/integration/intelligence/engine-fixtures.test.ts`) runs the engine over it and scores the result
 * with `scoreGrouping`.
 *
 * Offsets are seconds after the storm starts; incidents are correlated in time order, as discovery would.
 */
export interface StormIncident {
  label: string;
  service: 'checkout' | 'edge' | 'storage' | 'misc';
  title: string;
  offsetSeconds: number;
  urgency?: 'LOW' | 'MEDIUM' | 'HIGH';
}

const series = (
  label: string,
  service: StormIncident['service'],
  count: number,
  start: number,
  step: number,
  title: (i: number) => string
): StormIncident[] =>
  Array.from({ length: count }, (_, i) => ({
    label,
    service,
    title: title(i + 1),
    offsetSeconds: start + i * step,
  }));

export const STORM_INCIDENTS: readonly StormIncident[] = [
  // Three real problems, each paging many times.
  ...series('db-checkout', 'checkout', 12, 0, 20, i => `Database errors on db-primary-${i}`),
  ...series('tls-edge', 'edge', 8, 10, 15, i => `TLS certificate expiring for host api-${i}`),
  ...series('disk-storage', 'storage', 6, 5, 25, i => `Disk usage above 90% on node-${i}`),
  // One-offs during the storm.
  {
    label: 'one-off-webhook',
    service: 'misc',
    title: 'Payment webhook signature mismatch',
    offsetSeconds: 40,
  },
  {
    label: 'one-off-cron',
    service: 'misc',
    title: 'Cron job nightly-report missed its run',
    offsetSeconds: 70,
  },
  {
    label: 'one-off-queue',
    service: 'misc',
    title: 'Queue consumer lag on billing',
    offsetSeconds: 95,
  },
  {
    label: 'one-off-search',
    service: 'misc',
    title: 'Search index rebuild failed',
    offsetSeconds: 130,
  },
  {
    label: 'one-off-smtp',
    service: 'misc',
    title: 'SMTP relay rejected outbound messages',
    offsetSeconds: 160,
  },
  {
    label: 'one-off-flags',
    service: 'misc',
    title: 'Feature flag service timeout',
    offsetSeconds: 190,
  },
  // Decoys: same text as the database problem, but another service, much later, or page-immediately.
  {
    label: 'db-on-edge',
    service: 'edge',
    title: 'Database errors on db-primary-99',
    offsetSeconds: 100,
  },
  {
    label: 'db-an-hour-later',
    service: 'checkout',
    title: 'Database errors on db-primary-3',
    offsetSeconds: 3_600,
  },
  {
    label: 'db-critical',
    service: 'checkout',
    title: 'Database errors on db-primary-50',
    offsetSeconds: 60,
    urgency: 'HIGH',
  },
];

export const STORM_EXPECTED = {
  /** Distinct labels: the clusters a perfect engine would produce. */
  clusters: new Set(STORM_INCIDENTS.map(i => i.label)).size,
  /** Incidents per produced cluster must reach this (perfect: 35 / 12 ≈ 2.92). */
  minCompressionRatio: 2.9,
  /** No produced group may mix two real problems. */
  maxFalseGroupRate: 0,
  /** Every member of a real problem lands in that problem's cluster. */
  minPairRecall: 1,
} as const;

export interface GroupingScore {
  incidents: number;
  clusters: number;
  compressionRatio: number;
  /** Produced multi-incident clusters whose members carry more than one label, over all such clusters. */
  falseGroupRate: number;
  /** Same-label incident pairs that ended in the same cluster, over all same-label pairs. */
  pairRecall: number;
}

/**
 * Scores a grouping. `clusterOf` maps each incident key to the cluster it ended in; an incident in no group is
 * its own cluster.
 */
export function scoreGrouping(
  labelled: ReadonlyArray<{ key: string; label: string }>,
  clusterOf: ReadonlyMap<string, string>
): GroupingScore {
  const placed = labelled.map(({ key, label }) => ({
    label,
    cluster: clusterOf.get(key) ?? `alone:${key}`,
  }));
  // cluster → the labels of its members, and how many members it has.
  const clusters = new Map<string, { labels: Set<string>; size: number }>();
  for (const { label, cluster } of placed) {
    const entry = clusters.get(cluster) ?? { labels: new Set<string>(), size: 0 };
    entry.labels.add(label);
    entry.size += 1;
    clusters.set(cluster, entry);
  }
  const multi = [...clusters.values()].filter(entry => entry.size > 1);
  const mixed = multi.filter(entry => entry.labels.size > 1).length;
  let pairs = 0;
  let together = 0;
  placed.forEach((a, i) => {
    for (const b of placed.slice(i + 1)) {
      if (a.label !== b.label) continue;
      pairs += 1;
      if (a.cluster === b.cluster) together += 1;
    }
  });
  return {
    incidents: labelled.length,
    clusters: clusters.size,
    compressionRatio: labelled.length / Math.max(1, clusters.size),
    falseGroupRate: multi.length ? mixed / multi.length : 0,
    pairRecall: pairs ? together / pairs : 1,
  };
}
