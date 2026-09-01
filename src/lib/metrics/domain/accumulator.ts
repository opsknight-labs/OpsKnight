export type MetricAccumulator = {
  incidentCount: bigint;
  ackedCount: bigint;
  resolvedCount: bigint;
  mttaSumMs: bigint;
  mttaCount: bigint;
  mttrSumMs: bigint;
  mttrCount: bigint;
  ackMet: bigint;
  ackBreached: bigint;
  ackPending: bigint;
  resolveMet: bigint;
  resolveBreached: bigint;
  resolvePending: bigint;
  escalationEvents: bigint;
  escalatedIncidents: bigint;
  reopenEvents: bigint;
  reopenedIncidents: bigint;
  autoResolvedIncidents: bigint;
  afterHoursCount: bigint;
  alertCount: bigint;
};

export const METRIC_ACCUMULATOR = Symbol('opsknight.metrics.accumulator');

export function emptyMetricAccumulator(): MetricAccumulator {
  const zero = BigInt(0);
  return {
    incidentCount: zero,
    ackedCount: zero,
    resolvedCount: zero,
    mttaSumMs: zero,
    mttaCount: zero,
    mttrSumMs: zero,
    mttrCount: zero,
    ackMet: zero,
    ackBreached: zero,
    ackPending: zero,
    resolveMet: zero,
    resolveBreached: zero,
    resolvePending: zero,
    escalationEvents: zero,
    escalatedIncidents: zero,
    reopenEvents: zero,
    reopenedIncidents: zero,
    autoResolvedIncidents: zero,
    afterHoursCount: zero,
    alertCount: zero,
  };
}

export function mergeMetricAccumulators(...values: MetricAccumulator[]): MetricAccumulator {
  return values.reduce<MetricAccumulator>(
    (left, right) => ({
      incidentCount: left.incidentCount + right.incidentCount,
      ackedCount: left.ackedCount + right.ackedCount,
      resolvedCount: left.resolvedCount + right.resolvedCount,
      mttaSumMs: left.mttaSumMs + right.mttaSumMs,
      mttaCount: left.mttaCount + right.mttaCount,
      mttrSumMs: left.mttrSumMs + right.mttrSumMs,
      mttrCount: left.mttrCount + right.mttrCount,
      ackMet: left.ackMet + right.ackMet,
      ackBreached: left.ackBreached + right.ackBreached,
      ackPending: left.ackPending + right.ackPending,
      resolveMet: left.resolveMet + right.resolveMet,
      resolveBreached: left.resolveBreached + right.resolveBreached,
      resolvePending: left.resolvePending + right.resolvePending,
      escalationEvents: left.escalationEvents + right.escalationEvents,
      escalatedIncidents: left.escalatedIncidents + right.escalatedIncidents,
      reopenEvents: left.reopenEvents + right.reopenEvents,
      reopenedIncidents: left.reopenedIncidents + right.reopenedIncidents,
      autoResolvedIncidents: left.autoResolvedIncidents + right.autoResolvedIncidents,
      afterHoursCount: left.afterHoursCount + right.afterHoursCount,
      alertCount: left.alertCount + right.alertCount,
    }),
    emptyMetricAccumulator()
  );
}

export function deriveRate(numerator: bigint, denominator: bigint): number | null {
  return denominator === BigInt(0) ? null : (Number(numerator) / Number(denominator)) * 100;
}

export function deriveAverageMs(sum: bigint, count: bigint): number | null {
  return count === BigInt(0) ? null : Number(sum) / Number(count);
}
