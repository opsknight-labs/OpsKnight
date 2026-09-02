import { describe, it, expect } from 'vitest';
import { mergeHybridMetrics } from '@/lib/sla-hybrid-merge';
import type { SLAMetrics } from '@/lib/sla';
import { METRIC_ACCUMULATOR, emptyMetricAccumulator } from '@/lib/metrics/domain/accumulator';

// Tiny factory that fills the SLAMetrics shape with sensible defaults
// so each test can override only the fields it cares about.
function metric(overrides: Partial<SLAMetrics> = {}): SLAMetrics {
  const result: SLAMetrics = {
    effectiveStart: new Date('2024-01-01T00:00:00Z'),
    effectiveEnd: new Date('2024-01-31T23:59:59Z'),
    requestedStart: new Date('2024-01-01T00:00:00Z'),
    requestedEnd: new Date('2024-01-31T23:59:59Z'),
    isClipped: false,
    retentionDays: 730,

    mttr: null,
    mttd: null,
    mtti: null,
    mttk: null,
    mttaP50: null,
    mttaP95: null,
    mttrP50: null,
    mttrP95: null,
    mtbfMs: null,

    ackCompliance: null,
    resolveCompliance: null,
    ackBreaches: 0,
    resolveBreaches: 0,

    totalIncidents: 0,
    resolvedIncidents: 0,
    activeIncidents: 0,
    unassignedActive: 0,
    highUrgencyCount: 0,
    mediumUrgencyCount: 0,
    lowUrgencyCount: 0,
    alertsCount: 0,
    openCount: 0,
    acknowledgedCount: 0,
    snoozedCount: 0,
    suppressedCount: 0,
    resolved24h: 0,
    dynamicStatus: 'OPERATIONAL',
    activeCount: 0,
    criticalCount: 0,

    ackRate: 0,
    resolveRate: 0,
    highUrgencyRate: 0,
    afterHoursRate: 0,
    alertsPerIncident: 0,
    escalationRate: 0,
    reopenRate: 0,
    autoResolveRate: 0,

    previousPeriod: {
      totalIncidents: 0,
      highUrgencyCount: 0,
      mtta: null,
      mttr: null,
      ackRate: 0,
      resolveRate: 0,
    },

    coveragePercent: 0,
    coverageGapDays: 0,
    onCallHoursMs: 0,
    onCallUsersCount: 0,
    activeOverrides: 0,

    autoResolvedCount: 0,
    manualResolvedCount: 0,
    eventsCount: 0,

    avgLatencyP99: null,
    errorRate: null,
    totalRequests: 0,
    saturation: null,

    trendSeries: [],
    statusMix: [],
    urgencyMix: [],
    topServices: [],
    assigneeLoad: [],
    statusAges: [],
    onCallLoad: [],
    serviceSlaTable: [],

    recurringTitles: [],
    eventsPerIncident: 0,
    heatmapData: [],

    serviceMetrics: [],
    insights: [],
    currentShifts: [],
    ...overrides,
  };
  if (!Reflect.get(result, METRIC_ACCUMULATOR)) {
    const accumulator = emptyMetricAccumulator();
    accumulator.incidentCount = BigInt(result.totalIncidents);
    accumulator.ackedCount = BigInt(Math.round((result.ackRate / 100) * result.totalIncidents));
    accumulator.resolvedCount = BigInt(
      result.resolvedIncidents || Math.round((result.resolveRate / 100) * result.totalIncidents)
    );
    accumulator.mttaCount = accumulator.ackedCount;
    accumulator.mttaSumMs = BigInt(
      Math.round((result.mttd ?? 0) * 60_000 * Number(accumulator.mttaCount))
    );
    accumulator.mttrCount = accumulator.resolvedCount;
    accumulator.mttrSumMs = BigInt(
      Math.round((result.mttr ?? 0) * 60_000 * Number(accumulator.mttrCount))
    );
    accumulator.ackBreached = BigInt(result.ackBreaches);
    accumulator.ackMet = BigInt(
      Math.max(0, Math.round((result.ackRate / 100) * result.totalIncidents) - result.ackBreaches)
    );
    accumulator.resolveBreached = BigInt(result.resolveBreaches);
    accumulator.resolveMet = BigInt(
      Math.max(
        0,
        Math.round((result.resolveRate / 100) * result.totalIncidents) - result.resolveBreaches
      )
    );
    accumulator.escalatedIncidents = BigInt(
      Math.round((result.escalationRate / 100) * result.totalIncidents)
    );
    accumulator.reopenedIncidents = BigInt(
      Math.round((result.reopenRate / 100) * Number(accumulator.resolvedCount))
    );
    accumulator.autoResolvedIncidents = BigInt(result.autoResolvedCount);
    accumulator.afterHoursCount = BigInt(
      Math.round((result.afterHoursRate / 100) * result.totalIncidents)
    );
    accumulator.alertCount = BigInt(result.alertsCount);
    Reflect.set(result, METRIC_ACCUMULATOR, accumulator);
  }
  return result;
}

describe('mergeHybridMetrics', () => {
  it('sums totalIncidents and urgency counts across partitions', () => {
    const historical = metric({
      totalIncidents: 100,
      highUrgencyCount: 20,
      mediumUrgencyCount: 30,
      lowUrgencyCount: 50,
    });
    const live = metric({
      totalIncidents: 25,
      highUrgencyCount: 5,
      mediumUrgencyCount: 10,
      lowUrgencyCount: 10,
    });

    const merged = mergeHybridMetrics(historical, live);

    expect(merged.totalIncidents).toBe(125);
    expect(merged.highUrgencyCount).toBe(25);
    expect(merged.mediumUrgencyCount).toBe(40);
    expect(merged.lowUrgencyCount).toBe(60);
    expect(merged.dataSource).toBe('hybrid');
  });

  it('weights MTTR by reconstructed resolved counts', () => {
    // hist: 100 incidents, 80% resolveRate → 80 resolved, mttr = 60min
    // live:  20 incidents, 50% resolveRate → 10 resolved, mttr = 30min
    // weighted: (60*80 + 30*10) / (80+10) = (4800+300)/90 = 56.666...
    const historical = metric({ totalIncidents: 100, resolveRate: 80, mttr: 60 });
    const live = metric({ totalIncidents: 20, resolveRate: 50, mttr: 30 });

    const merged = mergeHybridMetrics(historical, live);

    expect(merged.mttr).not.toBeNull();
    expect(merged.mttr!).toBeCloseTo(56.67, 1);
  });

  it('returns null MTTR when both partitions have zero resolved', () => {
    const historical = metric({ totalIncidents: 50, resolveRate: 0, mttr: null });
    const live = metric({ totalIncidents: 10, resolveRate: 0, mttr: null });

    const merged = mergeHybridMetrics(historical, live);

    expect(merged.mttr).toBeNull();
  });

  it('calculates merged reopen rate against resolved incidents', () => {
    // Historical: 40 resolved, 25% reopened => 10 reopened.
    // Live: 10 resolved, 20% reopened => 2 reopened.
    // Merged: 12 / 50 resolved = 24%.
    const historical = metric({ totalIncidents: 100, resolveRate: 40, reopenRate: 25 });
    const live = metric({
      totalIncidents: 20,
      resolvedIncidents: 10,
      resolveRate: 50,
      reopenRate: 20,
    });

    const merged = mergeHybridMetrics(historical, live);

    expect(merged.resolvedIncidents).toBe(50);
    expect(merged.reopenRate).toBeCloseTo(24, 5);
  });

  it('reconstructs ack compliance from breaches + rate, then sums and re-divides', () => {
    // hist: ackCompliance=80%, 25 breaches.
    //   80% means met / (met+25) = 0.8 → met = 100, total_evaluated = 125.
    // live: ackCompliance=50%, 5 breaches.
    //   50% means met / (met+5) = 0.5 → met = 5, total_evaluated = 10.
    // merged: 105 met, 30 breached, 135 evaluated → 105/135 ≈ 77.78%.
    const historical = metric({
      totalIncidents: 125,
      ackRate: 100,
      ackCompliance: 80,
      ackBreaches: 25,
    });
    const live = metric({ totalIncidents: 10, ackRate: 100, ackCompliance: 50, ackBreaches: 5 });

    const merged = mergeHybridMetrics(historical, live);

    expect(merged.ackCompliance).not.toBeNull();
    expect(merged.ackCompliance!).toBeCloseTo(77.78, 1);
    expect(merged.ackBreaches).toBe(30);
  });

  it('returns null compliance when neither partition evaluated anything', () => {
    const historical = metric({ ackCompliance: null, ackBreaches: 0 });
    const live = metric({ ackCompliance: null, ackBreaches: 0 });

    const merged = mergeHybridMetrics(historical, live);

    expect(merged.ackCompliance).toBeNull();
    expect(merged.resolveCompliance).toBeNull();
  });

  it('always returns null percentiles in hybrid mode', () => {
    const historical = metric({ mttaP50: null, mttaP95: null });
    // Even if the live partition produced real percentiles, merging
    // them from summaries is mathematically impossible, so hybrid
    // contract says null.
    const live = metric({ mttaP50: 30, mttaP95: 90, mttrP50: 60, mttrP95: 180 });

    const merged = mergeHybridMetrics(historical, live);

    expect(merged.mttaP50).toBeNull();
    expect(merged.mttaP95).toBeNull();
    expect(merged.mttrP50).toBeNull();
    expect(merged.mttrP95).toBeNull();
  });

  it('takes snapshot-of-now fields from the live partition only', () => {
    const historical = metric({
      resolved24h: 999,
      unassignedActive: 999,
      dynamicStatus: 'CRITICAL',
      coveragePercent: 0,
      currentShifts: [],
    });
    const live = metric({
      resolved24h: 7,
      unassignedActive: 3,
      dynamicStatus: 'DEGRADED',
      coveragePercent: 100,
      currentShifts: [],
    });

    const merged = mergeHybridMetrics(historical, live);

    expect(merged.resolved24h).toBe(7);
    expect(merged.unassignedActive).toBe(3);
    expect(merged.dynamicStatus).toBe('DEGRADED');
    expect(merged.coveragePercent).toBe(100);
  });

  it('takes trend/heatmap/serviceMetrics/recentIncidents from the live partition', () => {
    const liveTrend = [
      {
        key: 'a',
        label: 'a',
        count: 1,
        mtta: 0,
        mttr: 0,
        ackRate: 0,
        resolveRate: 0,
        ackCompliance: 0,
        resolveCount: 0,
        escalationRate: 0,
      },
    ];
    const historical = metric({ trendSeries: [], heatmapData: [] });
    const live = metric({
      trendSeries: liveTrend,
      heatmapData: [{ date: '2024-01-01', count: 1 }],
    });

    const merged = mergeHybridMetrics(historical, live);

    expect(merged.trendSeries).toBe(liveTrend);
    expect(merged.heatmapData).toHaveLength(1);
  });

  it('preserves the user-requested range across both partitions', () => {
    const historical = metric({
      requestedStart: new Date('2024-01-01T00:00:00Z'),
      requestedEnd: new Date('2024-01-31T23:59:59Z'),
    });
    const live = metric({
      requestedStart: new Date('2024-02-01T00:00:00Z'),
      requestedEnd: new Date('2024-04-15T23:59:59Z'),
    });

    const merged = mergeHybridMetrics(historical, live);

    expect(merged.requestedStart.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(merged.requestedEnd.toISOString()).toBe('2024-04-15T23:59:59.000Z');
  });

  it('OR-merges isClipped across partitions', () => {
    const historical = metric({ isClipped: true });
    const live = metric({ isClipped: false });

    expect(mergeHybridMetrics(historical, live).isClipped).toBe(true);

    const both = mergeHybridMetrics(metric({ isClipped: false }), metric({ isClipped: false }));
    expect(both.isClipped).toBe(false);
  });
});
