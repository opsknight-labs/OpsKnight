import type { SLAMetrics } from './sla';
import {
  METRIC_ACCUMULATOR,
  deriveAverageMs,
  deriveRate,
  mergeMetricAccumulators,
} from './metrics/domain/accumulator';

/**
 * Hybrid merge for SLA metrics over a range that straddles the
 * real-time / rollup boundary (`realTimeWindowDays`).
 *
 * The two partitions:
 *   - `historical` — rollup-derived metrics for [start, realtimeStart)
 *   - `live`       — live-DB-derived metrics for [realtimeStart, end]
 *
 * Both inputs must carry the canonical additive accumulator. Hybrid headline
 * values are derived once after accumulator addition; summary rates are never
 * reverse-engineered into counts. Non-additive percentiles remain null.
 *
 * Field-by-field policy:
 *   - **Counts**: straight sum (totalIncidents, breaches, urgency
 *     buckets, escalation/reopen/autoResolve, alerts, etc.).
 *   - **Averages**: derived from exact accumulated sums and sample counts.
 *   - **Percentiles (P50/P95)**: cannot merge from summaries; always
 *     `null` in hybrid mode. The UI should render "n/a" rather than a
 *     misleading number.
 *   - **Compliance (ack/resolve)**: derived from exact met/breached counts.
 *   - **Rates (afterHoursRate, escalationRate, …)**: recompute against
 *     the merged total.
 *   - **Snapshot-of-"now" fields** (resolved24h, unassignedActive,
 *     snoozedCount, suppressedCount, criticalCount, dynamicStatus,
 *     coverage, on-call, currentShifts): take from the *live*
 *     partition only — these are "current state" by definition.
 *   - **Trends, heatmap, recurringTitles, recentIncidents,
 *     serviceMetrics**: take from the live partition. Rollups don't
 *     carry these in directly-usable form; the live partition's
 *     versions cover the most-recent window the user actually wants
 *     to drill into.
 *   - **previousPeriod**: take from the live partition. It's a
 *     same-duration shift, computed against the live partition only
 *     — best-effort under hybrid mode.
 *   - **Retention metadata**: `effectiveStart`/`requestedStart` come
 *     from the historical side (the earlier of the two), `*End` from
 *     the live side, `isClipped` is OR of the two.
 */

export function mergeHybridMetrics(
  historical: SLAMetrics,
  live: SLAMetrics
): SLAMetrics & { dataSource: 'hybrid' } {
  const totalIncidents = historical.totalIncidents + live.totalIncidents;
  const historicalAccumulator = Reflect.get(historical, METRIC_ACCUMULATOR) as
    | NonNullable<SLAMetrics[typeof METRIC_ACCUMULATOR]>
    | undefined;
  const liveAccumulator = Reflect.get(live, METRIC_ACCUMULATOR) as
    | NonNullable<SLAMetrics[typeof METRIC_ACCUMULATOR]>
    | undefined;
  const mergedAccumulator =
    historicalAccumulator && liveAccumulator
      ? mergeMetricAccumulators(historicalAccumulator, liveAccumulator)
      : null;
  if (!mergedAccumulator) {
    throw new Error('Hybrid metrics require canonical additive accumulators from both sources');
  }

  const ackBreachesTotal = Number(mergedAccumulator.ackBreached);
  const ackCompliance = deriveRate(
    mergedAccumulator.ackMet,
    mergedAccumulator.ackMet + mergedAccumulator.ackBreached
  );

  const resolveBreachesTotal = Number(mergedAccumulator.resolveBreached);
  const resolveCompliance = deriveRate(
    mergedAccumulator.resolveMet,
    mergedAccumulator.resolveMet + mergedAccumulator.resolveBreached
  );
  const ackedTotal = Number(mergedAccumulator.ackedCount);
  const resolvedTotal = Number(mergedAccumulator.resolvedCount);
  const accumulatedMttrMs = deriveAverageMs(
    mergedAccumulator.mttrSumMs,
    mergedAccumulator.mttrCount
  );
  const accumulatedMttaMs = deriveAverageMs(
    mergedAccumulator.mttaSumMs,
    mergedAccumulator.mttaCount
  );
  const mttr = accumulatedMttrMs === null ? null : accumulatedMttrMs / 60_000;
  const mttd = accumulatedMttaMs === null ? null : accumulatedMttaMs / 60_000;

  // Urgency / event totals — straight sum.
  const highUrgencyCount = historical.highUrgencyCount + live.highUrgencyCount;
  const mediumUrgencyCount = historical.mediumUrgencyCount + live.mediumUrgencyCount;
  const lowUrgencyCount = historical.lowUrgencyCount + live.lowUrgencyCount;
  const escalationCount = Number(mergedAccumulator.escalatedIncidents);
  const reopenCount = Number(mergedAccumulator.reopenedIncidents);
  const autoResolveCount = Number(mergedAccumulator.autoResolvedIncidents);
  const afterHoursCount = Number(mergedAccumulator.afterHoursCount);
  const alertsCountTotal = Number(mergedAccumulator.alertCount);
  const eventsCountTotal = Number(
    mergedAccumulator.escalationEvents +
      mergedAccumulator.reopenEvents +
      mergedAccumulator.autoResolveEvents
  );

  // Rates against merged total.
  const safeRate = (count: number) => (totalIncidents > 0 ? (count / totalIncidents) * 100 : 0);
  const ackRate = safeRate(ackedTotal);
  const resolveRate = safeRate(resolvedTotal);
  const highUrgencyRate = safeRate(highUrgencyCount);
  const afterHoursRate = safeRate(afterHoursCount);
  const escalationRate = safeRate(escalationCount);
  const reopenRate = resolvedTotal > 0 ? (reopenCount / resolvedTotal) * 100 : 0;
  const autoResolveRate = resolvedTotal > 0 ? (autoResolveCount / resolvedTotal) * 100 : 0;

  return {
    dataSource: 'hybrid',
    [METRIC_ACCUMULATOR]: mergedAccumulator,

    // Range metadata: span both partitions.
    requestedStart: historical.requestedStart,
    requestedEnd: live.requestedEnd,
    effectiveStart: historical.effectiveStart,
    effectiveEnd: live.effectiveEnd,
    isClipped: historical.isClipped || live.isClipped,
    retentionDays: live.retentionDays,

    // Counts (summed across partitions).
    totalIncidents,
    resolvedIncidents: resolvedTotal,
    activeIncidents: live.activeIncidents, // "active" is current-state
    openCount: live.openCount,
    acknowledgedCount: live.acknowledgedCount,
    highUrgencyCount,
    mediumUrgencyCount,
    lowUrgencyCount,
    activeCount: live.activeCount,

    // Snapshot-of-now: come from the live partition.
    resolved24h: live.resolved24h,
    unassignedActive: live.unassignedActive,
    alertsCount: alertsCountTotal,
    snoozedCount: live.snoozedCount,
    suppressedCount: live.suppressedCount,
    criticalCount: live.criticalCount,

    // Lifecycle: MTTR and MTTD weighted, percentiles null in hybrid mode.
    mttr,
    mttd,
    mtti: null,
    mttk: null,
    mttaP50: null,
    mttaP95: null,
    mttrP50: null,
    mttrP95: null,
    mtbfMs: null,

    // Compliance: reconstructed from breaches + rate.
    ackCompliance,
    resolveCompliance,
    ackBreaches: ackBreachesTotal,
    resolveBreaches: resolveBreachesTotal,

    // Rates against merged total.
    ackRate,
    resolveRate,
    highUrgencyRate,
    afterHoursRate,
    alertsPerIncident: totalIncidents > 0 ? alertsCountTotal / totalIncidents : 0,
    escalationRate,
    reopenRate,
    autoResolveRate,

    // Current-state status from live partition (live computes it properly).
    dynamicStatus: live.dynamicStatus,

    // Coverage is forward-looking; live partition's value is authoritative.
    coveragePercent: live.coveragePercent,
    coverageGapDays: live.coverageGapDays,
    onCallHoursMs: live.onCallHoursMs,
    onCallUsersCount: live.onCallUsersCount,
    activeOverrides: live.activeOverrides,

    // Events.
    autoResolvedCount: autoResolveCount,
    manualResolvedCount: Math.max(0, resolvedTotal - autoResolveCount),
    eventsCount: eventsCountTotal,

    // Golden signals (live only).
    avgLatencyP99: live.avgLatencyP99,
    errorRate: live.errorRate,
    totalRequests: live.totalRequests,
    saturation: live.saturation,

    // previousPeriod: live partition's same-duration comparison only.
    // Best-effort in hybrid mode; documented in the public PR.
    previousPeriod: live.previousPeriod,

    // Detail fields currently come from the live partition. Publish that
    // narrower interval as data, rather than allowing consumers to assume it
    // matches the full-range headline accumulator.
    detailCoverage: {
      mode: 'bounded-detail',
      start: live.effectiveStart,
      end: live.effectiveEnd,
      sampledIncidents: live.detailCoverage?.sampledIncidents,
      totalIncidents: live.totalIncidents,
      fields: [
        'trendSeries',
        'statusMix',
        'urgencyMix',
        'topServices',
        'assigneeLoad',
        'statusAges',
        'onCallLoad',
        'serviceSlaTable',
        'recurringTitles',
        'heatmapData',
        'serviceMetrics',
        'insights',
      ],
    },
    trendSeries: live.trendSeries,
    statusMix: live.statusMix,
    urgencyMix: live.urgencyMix,
    topServices: live.topServices,
    assigneeLoad: live.assigneeLoad,
    statusAges: live.statusAges,
    onCallLoad: live.onCallLoad,
    serviceSlaTable: live.serviceSlaTable,
    recurringTitles: live.recurringTitles,
    eventsPerIncident: totalIncidents > 0 ? eventsCountTotal / totalIncidents : 0,
    heatmapData: live.heatmapData, // 365-day heatmap always comes from live
    serviceMetrics: live.serviceMetrics,
    insights: live.insights,
    currentShifts: live.currentShifts,
    recentIncidents: live.recentIncidents,
  };
}
