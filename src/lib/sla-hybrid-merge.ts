import type { SLAMetrics } from './sla';

/**
 * Hybrid merge for SLA metrics over a range that straddles the
 * real-time / rollup boundary (`realTimeWindowDays`).
 *
 * The two partitions:
 *   - `historical` — rollup-derived metrics for [start, realtimeStart)
 *   - `live`       — live-DB-derived metrics for [realtimeStart, end]
 *
 * Both inputs are full `SLAMetrics` shapes, so we don't have direct
 * access to the underlying sums and counts. Where exact arithmetic is
 * possible we reconstruct met/breached/acked/resolved counts from the
 * fields we do have (`ackBreaches`, `resolveBreaches`, `ackRate`,
 * `resolveRate`, `totalIncidents`) and sum them. Where reconstruction
 * isn't safe (percentiles) we honestly return `null` rather than
 * pretending to merge.
 *
 * Field-by-field policy:
 *   - **Counts**: straight sum (totalIncidents, breaches, urgency
 *     buckets, escalation/reopen/autoResolve, alerts, etc.).
 *   - **Averages (MTTR)**: weighted by reconstructed acked/resolved
 *     counts. Null if both sides null OR both sides have zero
 *     resolveds.
 *   - **Percentiles (P50/P95)**: cannot merge from summaries; always
 *     `null` in hybrid mode. The UI should render "n/a" rather than a
 *     misleading number.
 *   - **Compliance (ack/resolve)**: reconstruct met counts from rate
 *     and breach count, sum, recompute.
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

  // Reconstruct met counts from rate + breaches.
  // Compliance = met / (met + breached) * 100. If both met+breached = 0
  // compliance is null (no evaluation possible). When compliance is
  // null we treat met as 0.
  const reconstructMet = (
    compliance: number | null,
    breaches: number,
    totalIncidents: number,
    rate: number
  ): number => {
    if (compliance === null || !Number.isFinite(compliance) || compliance <= 0) return 0;
    const evaluatedTotal = Math.round((rate / 100) * totalIncidents);
    if (breaches === 0) {
      return compliance >= 100 ? evaluatedTotal : 0;
    }
    if (compliance >= 100) return Math.max(0, evaluatedTotal - breaches);
    const totalEvaluated = breaches / (1 - compliance / 100);
    const result = Math.round(totalEvaluated - breaches);
    return Number.isFinite(result) ? Math.max(0, result) : 0;
  };

  const ackMetHist = reconstructMet(
    historical.ackCompliance,
    historical.ackBreaches,
    historical.totalIncidents,
    historical.ackRate
  );
  const ackMetLive = reconstructMet(
    live.ackCompliance,
    live.ackBreaches,
    live.totalIncidents,
    live.ackRate
  );
  const ackBreachesTotal = historical.ackBreaches + live.ackBreaches;
  const ackMetTotal = ackMetHist + ackMetLive;
  const ackEvaluatedTotal = ackMetTotal + ackBreachesTotal;
  const ackCompliance = ackEvaluatedTotal > 0 ? (ackMetTotal / ackEvaluatedTotal) * 100 : null;

  const resolveMetHist = reconstructMet(
    historical.resolveCompliance,
    historical.resolveBreaches,
    historical.totalIncidents,
    historical.resolveRate
  );
  const resolveMetLive = reconstructMet(
    live.resolveCompliance,
    live.resolveBreaches,
    live.totalIncidents,
    live.resolveRate
  );
  const resolveBreachesTotal = historical.resolveBreaches + live.resolveBreaches;
  const resolveMetTotal = resolveMetHist + resolveMetLive;
  const resolveEvaluatedTotal = resolveMetTotal + resolveBreachesTotal;
  const resolveCompliance =
    resolveEvaluatedTotal > 0 ? (resolveMetTotal / resolveEvaluatedTotal) * 100 : null;

  // Reconstruct acked / resolved counts from rate * total.
  const ackedHist = Math.round((historical.ackRate / 100) * historical.totalIncidents);
  const ackedLive = Math.round((live.ackRate / 100) * live.totalIncidents);
  const resolvedHist = Math.round((historical.resolveRate / 100) * historical.totalIncidents);
  const resolvedLive = Math.round((live.resolveRate / 100) * live.totalIncidents);
  const ackedTotal = ackedHist + ackedLive;
  const resolvedTotal = resolvedHist + resolvedLive;

  // Weighted MTTR by resolved counts. (SLAMetrics has no top-level
  // `mtta` field — only the percentiles, which we null.)
  const weightedAvg = (
    valA: number | null,
    countA: number,
    valB: number | null,
    countB: number
  ): number | null => {
    const a = valA ?? null;
    const b = valB ?? null;
    if (a === null && b === null) return null;
    const sumA = a !== null ? a * countA : 0;
    const sumB = b !== null ? b * countB : 0;
    const wA = a !== null ? countA : 0;
    const wB = b !== null ? countB : 0;
    const totalW = wA + wB;
    return totalW > 0 ? (sumA + sumB) / totalW : null;
  };

  const mttr = weightedAvg(historical.mttr, resolvedHist, live.mttr, resolvedLive);
  const mttd = weightedAvg(historical.mttd, ackedHist, live.mttd, ackedLive);

  // Urgency / event totals — straight sum.
  const highUrgencyCount = historical.highUrgencyCount + live.highUrgencyCount;
  const mediumUrgencyCount = historical.mediumUrgencyCount + live.mediumUrgencyCount;
  const lowUrgencyCount = historical.lowUrgencyCount + live.lowUrgencyCount;
  const escalationCount = Math.round(
    (historical.escalationRate / 100) * historical.totalIncidents +
      (live.escalationRate / 100) * live.totalIncidents
  );
  // live.reopenRate was computed as (reopenCount / resolvedCount) * 100
  const liveReopenCount = Math.round(
    (live.reopenRate / 100) * (live.resolvedIncidents ?? live.totalIncidents)
  );
  // Both live and corrected historical metrics define reopen rate against
  // resolved incidents: an incident must have been resolved before reopening.
  const histReopenCount = Math.round((historical.reopenRate / 100) * resolvedHist);
  const reopenCount = liveReopenCount + histReopenCount;

  const autoResolveCount = historical.autoResolvedCount + live.autoResolvedCount;
  const afterHoursCount = Math.round(
    (historical.afterHoursRate / 100) * historical.totalIncidents +
      (live.afterHoursRate / 100) * live.totalIncidents
  );
  const alertsCountTotal = historical.alertsCount + live.alertsCount;

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
    eventsCount: historical.eventsCount + live.eventsCount,

    // Golden signals (live only).
    avgLatencyP99: live.avgLatencyP99,
    errorRate: live.errorRate,
    totalRequests: live.totalRequests,
    saturation: live.saturation,

    // previousPeriod: live partition's same-duration comparison only.
    // Best-effort in hybrid mode; documented in the public PR.
    previousPeriod: live.previousPeriod,

    // Trend / heatmap / detail come from live (rollups don't carry these).
    trendSeries: live.trendSeries,
    statusMix: live.statusMix,
    urgencyMix: live.urgencyMix,
    topServices: live.topServices,
    assigneeLoad: live.assigneeLoad,
    statusAges: live.statusAges,
    onCallLoad: live.onCallLoad,
    serviceSlaTable: live.serviceSlaTable,
    recurringTitles: live.recurringTitles,
    eventsPerIncident:
      totalIncidents > 0 ? (historical.eventsCount + live.eventsCount) / totalIncidents : 0,
    heatmapData: live.heatmapData, // 365-day heatmap always comes from live
    serviceMetrics: live.serviceMetrics,
    insights: live.insights,
    currentShifts: live.currentShifts,
    recentIncidents: live.recentIncidents,
  };
}
