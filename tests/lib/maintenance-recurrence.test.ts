import { describe, expect, it } from 'vitest';
import {
  describeRecurrence,
  nextOccurrence,
  occurrencesBetween,
  recurrenceError,
  type MaintenanceRecurrence,
} from '@/lib/service-maintenance/recurrence';

const rule = (overrides: Partial<MaintenanceRecurrence>): MaintenanceRecurrence => ({
  frequency: 'DAILY',
  interval: 1,
  byWeekday: [],
  dayOfMonth: null,
  timeZone: 'UTC',
  startTime: '02:00',
  durationMinutes: 120,
  startsOn: '2026-01-01',
  endsOn: null,
  ...overrides,
});

const starts = (r: MaintenanceRecurrence, from: string, to: string) =>
  occurrencesBetween(r, new Date(from), new Date(to)).map(o => o.startsAt.toISOString());

describe('maintenance recurrence', () => {
  it('keeps 02:00 local across America/New_York DST and moves the skipped hour forward', () => {
    const r = rule({ timeZone: 'America/New_York', startTime: '02:30' });
    // 2026-03-08: 02:00 -> 03:00 EDT, so 02:30 does not exist that day.
    expect(starts(r, '2026-03-07T00:00:00Z', '2026-03-09T23:59:00Z')).toEqual([
      '2026-03-07T07:30:00.000Z', // 02:30 EST
      '2026-03-08T07:30:00.000Z', // 03:30 EDT (gap moved forward)
      '2026-03-09T06:30:00.000Z', // 02:30 EDT
    ]);
    // 2026-11-01: 01:30 happens twice; the first (EDT) instant is used.
    const fallBack = rule({ timeZone: 'America/New_York', startTime: '01:30' });
    expect(starts(fallBack, '2026-10-31T00:00:00Z', '2026-11-02T23:59:00Z')).toEqual([
      '2026-10-31T05:30:00.000Z',
      '2026-11-01T05:30:00.000Z',
      '2026-11-02T06:30:00.000Z',
    ]);
  });

  it('handles Europe/London spring-forward and fall-back', () => {
    const r = rule({ timeZone: 'Europe/London', startTime: '01:30', durationMinutes: 60 });
    // 2026-03-29: 01:00 -> 02:00 BST.
    expect(starts(r, '2026-03-28T00:00:00Z', '2026-03-30T23:00:00Z')).toEqual([
      '2026-03-28T01:30:00.000Z',
      '2026-03-29T01:30:00.000Z', // 02:30 BST
      '2026-03-30T00:30:00.000Z', // 01:30 BST
    ]);
    // 2026-10-25: 02:00 BST -> 01:00 GMT; 01:30 repeats, first instant wins.
    expect(starts(r, '2026-10-24T00:00:00Z', '2026-10-26T23:00:00Z')).toEqual([
      '2026-10-24T00:30:00.000Z',
      '2026-10-25T00:30:00.000Z',
      '2026-10-26T01:30:00.000Z',
    ]);
    // Duration is elapsed time, so the window is exactly one hour.
    const [occurrence] = occurrencesBetween(
      r,
      new Date('2026-10-25T00:00:00Z'),
      new Date('2026-10-25T23:00:00Z')
    );
    expect(occurrence.endsAt.getTime() - occurrence.startsAt.getTime()).toBe(3_600_000);
  });

  it('clamps monthly day 31 to the last day of shorter months', () => {
    const r = rule({ frequency: 'MONTHLY', dayOfMonth: 31, durationMinutes: 60 });
    expect(starts(r, '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z')).toEqual([
      '2026-01-31T02:00:00.000Z',
      '2026-02-28T02:00:00.000Z',
      '2026-03-31T02:00:00.000Z',
      '2026-04-30T02:00:00.000Z',
    ]);
    const leap = rule({ frequency: 'MONTHLY', dayOfMonth: 30, startsOn: '2028-02-01' });
    expect(starts(leap, '2028-02-01T00:00:00Z', '2028-03-01T00:00:00Z')).toEqual([
      '2028-02-29T02:00:00.000Z',
    ]);
  });

  it('honours interval > 1 for days, weeks and months', () => {
    expect(starts(rule({ interval: 3 }), '2026-01-01T00:00:00Z', '2026-01-10T23:00:00Z')).toEqual([
      '2026-01-01T02:00:00.000Z',
      '2026-01-04T02:00:00.000Z',
      '2026-01-07T02:00:00.000Z',
      '2026-01-10T02:00:00.000Z',
    ]);
    // 2026-01-01 is a Thursday; every 2 weeks on Monday counts from that week.
    const weekly = rule({ frequency: 'WEEKLY', interval: 2, byWeekday: [1] });
    expect(starts(weekly, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toEqual([
      '2026-01-12T02:00:00.000Z',
      '2026-01-26T02:00:00.000Z',
    ]);
    const monthly = rule({ frequency: 'MONTHLY', interval: 2, dayOfMonth: 15 });
    expect(starts(monthly, '2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z')).toEqual([
      '2026-01-15T02:00:00.000Z',
      '2026-03-15T02:00:00.000Z',
      '2026-05-15T02:00:00.000Z',
    ]);
  });

  it('expands weekly multi-day rules and stops after endsOn (inclusive)', () => {
    const r = rule({
      frequency: 'WEEKLY',
      byWeekday: [6, 2],
      timeZone: 'Asia/Kolkata',
      endsOn: '2026-01-13',
    });
    // Tuesdays and Saturdays, 02:00 IST = 20:30 UTC the previous day.
    expect(starts(r, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toEqual([
      '2026-01-02T20:30:00.000Z', // Sat 3 Jan
      '2026-01-05T20:30:00.000Z', // Tue 6 Jan
      '2026-01-09T20:30:00.000Z', // Sat 10 Jan
      '2026-01-12T20:30:00.000Z', // Tue 13 Jan (endsOn)
    ]);
    expect(nextOccurrence(r, new Date('2026-01-13T00:00:00Z'))).toBeNull();
    expect(nextOccurrence(r, new Date('2026-01-06T00:00:00Z'))?.startsAt.toISOString()).toBe(
      '2026-01-09T20:30:00.000Z'
    );
  });

  it('never starts before startsOn and finds a far next occurrence', () => {
    const r = rule({ frequency: 'MONTHLY', interval: 12, dayOfMonth: 1, startsOn: '2026-06-01' });
    expect(nextOccurrence(r, new Date('2026-01-01T00:00:00Z'))?.startsAt.toISOString()).toBe(
      '2026-06-01T02:00:00.000Z'
    );
    expect(nextOccurrence(r, new Date('2026-06-02T00:00:00Z'))?.startsAt.toISOString()).toBe(
      '2027-06-01T02:00:00.000Z'
    );
  });

  it('rejects durations that overlap the next occurrence and incomplete rules', () => {
    expect(recurrenceError(rule({ durationMinutes: 1440 }))).toMatch(/before the next/);
    expect(recurrenceError(rule({ durationMinutes: 1380 }))).toBeNull();
    expect(
      recurrenceError(rule({ frequency: 'WEEKLY', byWeekday: [1, 2], durationMinutes: 1440 }))
    ).toMatch(/before the next/);
    expect(recurrenceError(rule({ frequency: 'WEEKLY', byWeekday: [] }))).toMatch(/weekday/);
    expect(recurrenceError(rule({ frequency: 'MONTHLY' }))).toMatch(/day of the month/);
    expect(recurrenceError(rule({ timeZone: 'Mars/Olympus' }))).toMatch(/time zone/);
    expect(recurrenceError(rule({ endsOn: '2025-12-31' }))).toMatch(/end date/);
  });

  it('describes a schedule for people', () => {
    expect(
      describeRecurrence(rule({ frequency: 'WEEKLY', byWeekday: [0], timeZone: 'Asia/Kolkata' }))
    ).toBe('Every Sunday 02:00–04:00 Asia/Kolkata');
    expect(
      describeRecurrence(
        rule({ frequency: 'MONTHLY', dayOfMonth: 31, interval: 2, endsOn: '2026-12-31' })
      )
    ).toBe('Every 2 months on the last day 02:00–04:00 UTC, until 2026-12-31');
    expect(describeRecurrence(rule({ interval: 2, startTime: '23:00' }))).toBe(
      'Every 2 days 23:00–01:00 UTC'
    );
  });
});
