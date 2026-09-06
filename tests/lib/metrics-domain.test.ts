import { describe, expect, it } from 'vitest';
import {
  deriveAverageMs,
  deriveRate,
  emptyMetricAccumulator,
  mergeMetricAccumulators,
} from '@/lib/metrics/domain/accumulator';
import { intervalDurationMs, intervalGaps, mergeIntervals } from '@/lib/metrics/domain/interval';
import { effectiveElapsedMs } from '@/lib/metrics/domain/sla-clock';
import { resolveSlaTarget } from '@/lib/metrics/domain/sla-target';

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 0, 1, hour, minute));

describe('canonical metric domain', () => {
  it('merges overlapping and adjacent half-open intervals without double counting', () => {
    const intervals = [
      { start: at(1), end: at(3) },
      { start: at(2), end: at(4) },
      { start: at(4), end: at(5) },
    ];
    expect(mergeIntervals(intervals)).toEqual([{ start: at(1), end: at(5) }]);
    expect(intervalDurationMs(intervals)).toBe(4 * 60 * 60 * 1000);
  });

  it('calculates real duration coverage and gaps', () => {
    const window = { start: at(0), end: at(10) };
    const covered = [
      { start: at(1), end: at(2) },
      { start: at(5), end: at(8) },
    ];
    expect(intervalDurationMs(covered)).toBe(4 * 60 * 60 * 1000);
    expect(intervalGaps(window, covered)).toEqual([
      { start: at(0), end: at(1) },
      { start: at(2), end: at(5) },
      { start: at(8), end: at(10) },
    ]);
  });

  it('subtracts the union of SLA pauses and caps active pauses at evaluation time', () => {
    expect(
      effectiveElapsedMs({
        startedAt: at(0),
        evaluationAt: at(10),
        pauses: [
          { startedAt: at(1), endedAt: at(3) },
          { startedAt: at(2), endedAt: at(5) },
          { startedAt: at(8), endedAt: null },
        ],
      })
    ).toBe(4 * 60 * 60 * 1000);
  });

  it('uses definition, priority, service, then global target precedence', () => {
    expect(
      resolveSlaTarget({
        priority: 'P1',
        definitionOverride: { ackMinutes: 2, resolveMinutes: 20 },
      }).source
    ).toBe('definition');
    expect(
      resolveSlaTarget({ priority: '1', serviceTargets: { ackMinutes: 90, resolveMinutes: 900 } })
    ).toMatchObject({ ackTargetMs: 300_000, source: 'priority' });
    expect(
      resolveSlaTarget({ serviceTargets: { ackMinutes: 20, resolveMinutes: 200 } })
    ).toMatchObject({ ackTargetMs: 1_200_000, source: 'service' });
    expect(resolveSlaTarget({})).toMatchObject({ ackTargetMs: 900_000, source: 'global' });
  });

  it('merges additive state exactly and preserves no-data semantics', () => {
    const first = {
      ...emptyMetricAccumulator(),
      incidentCount: BigInt(2),
      mttaSumMs: BigInt(600),
      mttaCount: BigInt(2),
      ackMet: BigInt(1),
    };
    const second = {
      ...emptyMetricAccumulator(),
      incidentCount: BigInt(3),
      mttaSumMs: BigInt(900),
      mttaCount: BigInt(3),
      ackBreached: BigInt(1),
    };
    const merged = mergeMetricAccumulators(first, second);
    expect(merged.incidentCount).toBe(BigInt(5));
    expect(deriveAverageMs(merged.mttaSumMs, merged.mttaCount)).toBe(300);
    expect(deriveRate(merged.ackMet, merged.ackMet + merged.ackBreached)).toBe(50);
    expect(deriveRate(BigInt(0), BigInt(0))).toBeNull();
  });
});
