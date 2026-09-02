import { describe, expect, it } from 'vitest';
import { resolveSlaTarget } from '@/lib/metrics/domain/sla-target';
import { slaTargetSql } from '@/lib/metrics/domain/sla-target-sql';
import { effectiveElapsedMs, effectiveMaterializedElapsedMs } from '@/lib/metrics/domain/sla-clock';

describe('canonical SLA target and pause clock', () => {
  it.each([
    ['P1', 5, 60],
    ['P2', 15, 240],
    ['P3', 30, 480],
    ['P4', 60, 1440],
    ['P5', 120, 2880],
  ])('applies %s before conflicting service targets', (priority, ack, resolve) => {
    const target = resolveSlaTarget({
      priority,
      serviceTargets: { ackMinutes: 90, resolveMinutes: 9000 },
    });
    expect(target).toMatchObject({
      ackTargetMs: ack * 60_000,
      resolveTargetMs: resolve * 60_000,
      source: 'priority',
    });
  });

  it('falls back from malformed priority to service and then global defaults', () => {
    expect(
      resolveSlaTarget({ priority: 'critical', serviceTargets: { ackMinutes: 22 } })
    ).toMatchObject({ ackTargetMs: 22 * 60_000, source: 'service' });
    expect(resolveSlaTarget({ priority: 'critical' })).toMatchObject({
      ackTargetMs: 15 * 60_000,
      resolveTargetMs: 120 * 60_000,
      source: 'global',
    });
  });

  it('builds parameterized SQL from the same priority constants', () => {
    const sql = slaTargetSql({
      kind: 'ackMinutes',
      serviceTargetMap: new Map([['service-a', { ackMinutes: 90, resolveMinutes: 900 }]]),
      fallbackMinutes: 15,
    });
    expect(sql.strings.join(' ')).toContain('UPPER');
    expect(sql.strings.join(' ')).toContain('REGEXP_REPLACE');
    expect(sql.values).toEqual(expect.arrayContaining(['P1', 5 * 60_000]));
    expect(sql.strings.join(' ')).toContain('FROM "Service"');
    expect(sql.values).not.toContain('service-a');
  });

  it('does not subtract a pause that starts after the evaluated event', () => {
    expect(
      effectiveElapsedMs({
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        evaluationAt: new Date('2026-01-01T00:05:00.000Z'),
        pauses: [
          {
            startedAt: new Date('2026-01-01T00:10:00.000Z'),
            endedAt: new Date('2026-01-01T00:20:00.000Z'),
          },
        ],
      })
    ).toBe(5 * 60_000);
  });

  it('keeps interval history and materialized clock equivalent', () => {
    const startedAt = new Date('2026-03-08T06:50:00.000Z');
    const evaluationAt = new Date('2026-03-08T07:20:00.000Z');
    const pauseStartedAt = new Date('2026-03-08T07:05:00.000Z');
    const expected = effectiveElapsedMs({
      startedAt,
      evaluationAt,
      pauses: [
        {
          startedAt: new Date('2026-03-08T06:55:00.000Z'),
          endedAt: new Date('2026-03-08T07:00:00.000Z'),
        },
        { startedAt: pauseStartedAt, endedAt: null },
      ],
    });
    expect(
      effectiveMaterializedElapsedMs({
        startedAt,
        evaluationAt,
        pausedMs: 5 * 60_000,
        pauseStartedAt,
      })
    ).toBe(expected);
  });
});
