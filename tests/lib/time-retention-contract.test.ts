import { describe, expect, it } from 'vitest';
import {
  createTimeContractContext,
  normalizeContractTimeZone,
  resolveReportingWindow,
  type RetentionDurations,
} from '@/lib/time-retention-contract';

const policy: RetentionDurations = {
  incidentRetentionDays: 730,
  alertRetentionDays: 365,
  logRetentionDays: 90,
  metricsRetentionDays: 365,
};
const now = new Date('2026-08-28T12:00:00.000Z');

describe('time and retention contract', () => {
  it.each([
    ['UTC', 'UTC'],
    ['Asia/Kolkata', 'Asia/Kolkata'],
    ['America/New_York', 'America/New_York'],
    ['not/a-zone', 'UTC'],
    ['', 'UTC'],
  ])('normalizes timezone %s to %s', (input, expected) => {
    expect(normalizeContractTimeZone(input)).toBe(expected);
  });

  it('keeps user and business timezone responsibilities explicit', () => {
    expect(
      createTimeContractContext({
        now,
        userTimeZone: 'Asia/Kolkata',
        businessTimeZone: 'America/Los_Angeles',
      })
    ).toEqual({
      now,
      userTimeZone: 'Asia/Kolkata',
      businessTimeZone: 'America/Los_Angeles',
    });
  });

  it.each([
    ['incident', 730],
    ['alert', 365],
    ['log', 90],
    ['metrics', 365],
  ] as const)('uses the configured %s retention duration', (dataType, retentionDays) => {
    const window = resolveReportingWindow({
      context: createTimeContractContext({ now }),
      policy,
      dataType,
    });

    expect(now.getTime() - window.retentionStart.getTime()).toBe(
      retentionDays * 24 * 60 * 60 * 1000
    );
    expect(window.effective.start).toEqual(window.retentionStart);
  });

  it('clips both an expired start and a future end with exact reasons', () => {
    const window = resolveReportingWindow({
      context: createTimeContractContext({ now }),
      policy,
      dataType: 'log',
      requestedStart: new Date('2025-01-01T00:00:00.000Z'),
      requestedEnd: new Date('2026-09-01T00:00:00.000Z'),
    });

    expect(window.effective.start).toEqual(new Date(now.getTime() - 90 * 86_400_000));
    expect(window.effective.end).toEqual(now);
    expect(window.clipReasons).toEqual(['future_end', 'retention_start']);
    expect(window.isClipped).toBe(true);
  });

  it('collapses an inverted range instead of silently swapping its meaning', () => {
    const requestedEnd = new Date('2026-08-20T12:00:00.000Z');
    const window = resolveReportingWindow({
      context: createTimeContractContext({ now }),
      policy,
      requestedStart: new Date('2026-08-21T12:00:00.000Z'),
      requestedEnd,
    });

    expect(window.effective).toEqual({ start: requestedEnd, end: requestedEnd });
    expect(window.clipReasons).toEqual(['start_after_end']);
  });

  it('uses one injected clock regardless of user timezone or DST boundaries', () => {
    const contexts = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata'].map(
      userTimeZone => createTimeContractContext({ now, userTimeZone })
    );
    const starts = contexts.map(context =>
      resolveReportingWindow({
        context,
        policy,
        defaultWindowDays: 30,
      }).effective.start.toISOString()
    );

    expect(new Set(starts)).toEqual(new Set(['2026-07-29T12:00:00.000Z']));
  });

  it('reports clipping when a default reporting window exceeds retention', () => {
    const window = resolveReportingWindow({
      context: createTimeContractContext({ now }),
      policy: { ...policy, incidentRetentionDays: 1 },
      defaultWindowDays: 7,
    });

    expect(window.requested.start).toEqual(new Date(now.getTime() - 7 * 86_400_000));
    expect(window.effective.start).toEqual(new Date(now.getTime() - 86_400_000));
    expect(window.clipReasons).toEqual(['retention_start']);
  });

  it('rejects an invalid injected clock', () => {
    expect(() => createTimeContractContext({ now: new Date(Number.NaN) })).toThrow(RangeError);
  });
});
