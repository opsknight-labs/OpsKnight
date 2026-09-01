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

export function emptyMetricAccumulator(): MetricAccumulator {
  return Object.fromEntries(
    [
      'incidentCount',
      'ackedCount',
      'resolvedCount',
      'mttaSumMs',
      'mttaCount',
      'mttrSumMs',
      'mttrCount',
      'ackMet',
      'ackBreached',
      'ackPending',
      'resolveMet',
      'resolveBreached',
      'resolvePending',
      'escalationEvents',
      'escalatedIncidents',
      'reopenEvents',
      'reopenedIncidents',
      'autoResolvedIncidents',
      'afterHoursCount',
      'alertCount',
    ].map(key => [key, BigInt(0)])
  ) as MetricAccumulator;
}

export function mergeMetricAccumulators(...values: MetricAccumulator[]): MetricAccumulator {
  const result = emptyMetricAccumulator();
  for (const value of values) {
    for (const key of Object.keys(result) as Array<keyof MetricAccumulator>)
      result[key] += value[key];
  }
  return result;
}

export function deriveRate(numerator: bigint, denominator: bigint): number | null {
  return denominator === BigInt(0) ? null : (Number(numerator) / Number(denominator)) * 100;
}

export function deriveAverageMs(sum: bigint, count: bigint): number | null {
  return count === BigInt(0) ? null : Number(sum) / Number(count);
}
