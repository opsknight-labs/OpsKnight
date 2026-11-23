import { describe, expect, it } from 'vitest';
import { computeBaseline, runningLong, shortDuration } from '@/lib/incidents/baseline';

const t0 = new Date('2026-11-01T00:00:00Z');
const after = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const row = (ackMin: number | null, resolveMin: number | null) => ({
  createdAt: t0,
  acknowledgedAt: ackMin === null ? null : after(ackMin),
  resolvedAt: resolveMin === null ? null : after(resolveMin),
});

describe('service baseline', () => {
  it('uses medians, so one long outage does not skew the usual', () => {
    expect(computeBaseline([row(2, 30), row(4, 40), row(6, 50), row(8, 10_000)])).toEqual({
      samples: 4,
      resolveMs: 45 * 60_000,
      ackMs: 5 * 60_000,
    });
  });

  it('says nothing with too few resolved incidents', () => {
    expect(computeBaseline([row(1, 30), row(1, null), row(null, 40)])).toBeNull();
  });

  it('flags an incident running at least twice the usual time', () => {
    const baseline = { samples: 5, resolveMs: 45 * 60_000, ackMs: null };
    expect(runningLong(60 * 60_000, baseline)).toBeNull();
    expect(runningLong(16 * 60 * 60_000, baseline)).toBe(21);
  });

  it('prints short durations', () => {
    expect(shortDuration(45 * 60_000)).toBe('45m');
    expect(shortDuration(3 * 3_600_000)).toBe('3h');
    expect(shortDuration(3 * 86_400_000)).toBe('3d');
  });
});
