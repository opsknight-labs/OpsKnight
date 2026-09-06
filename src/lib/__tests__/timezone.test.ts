import { describe, expect, it } from 'vitest';
import {
  addDaysToDateKey,
  formatDateKeyInTimeZone,
  parseDateTimeInTimeZone,
  resolveLocalDateTimeInTimeZone,
  startOfDayFromDateKey,
  startOfNextDayFromDateKey,
} from '../timezone';

describe('timezone helpers', () => {
  it('formats date keys using the provided timezone', () => {
    const date = new Date('2024-01-15T02:00:00Z');
    const key = formatDateKeyInTimeZone(date, 'America/New_York');
    expect(key).toBe('2024-01-14');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDaysToDateKey('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDaysToDateKey('2024-01-01', -1)).toBe('2023-12-31');
  });

  it('round-trips start of day keys in timezone boundaries', () => {
    const timeZone = 'America/New_York';
    const dateKey = '2024-03-10';
    const start = startOfDayFromDateKey(dateKey, timeZone);
    const nextStart = startOfNextDayFromDateKey(dateKey, timeZone);

    expect(formatDateKeyInTimeZone(start, timeZone)).toBe(dateKey);
    expect(formatDateKeyInTimeZone(nextStart, timeZone)).toBe('2024-03-11');
  });

  // Regression: getTimeZoneOffsetMs used `hour12: false`, which resolves to the
  // h24 hour cycle on Node 20's ICU and reports midnight as hour "24". That
  // rolled Date.UTC into the next day and produced a 24h offset error, so
  // start-of-day in a zero-offset zone landed a full day early — on Node 20
  // only. Node 22 defaults to h23 and was unaffected, so the two runtimes
  // silently disagreed about who was on call.
  it('resolves start of day in zero-offset zones without a day shift', () => {
    for (const timeZone of ['UTC', 'Europe/London', 'Africa/Abidjan']) {
      const start = startOfDayFromDateKey('2026-08-16', timeZone);
      expect(formatDateKeyInTimeZone(start, timeZone)).toBe('2026-08-16');
    }
  });

  it('keeps start of day at midnight across a range of zones and dates', () => {
    const zones = ['UTC', 'Asia/Kolkata', 'America/New_York', 'Australia/Sydney', 'Europe/London'];
    const dateKeys = ['2026-01-01', '2026-03-29', '2026-08-16', '2026-11-01', '2026-12-31'];

    for (const timeZone of zones) {
      for (const dateKey of dateKeys) {
        const start = startOfDayFromDateKey(dateKey, timeZone);
        expect(formatDateKeyInTimeZone(start, timeZone)).toBe(dateKey);

        const nextStart = startOfNextDayFromDateKey(dateKey, timeZone);
        expect(formatDateKeyInTimeZone(nextStart, timeZone)).toBe(addDaysToDateKey(dateKey, 1));
      }
    }
  });

  it('rejects nonexistent wall-clock input during spring-forward', () => {
    expect(parseDateTimeInTimeZone('2026-03-08T02:30', 'America/New_York')).toBeNull();
  });

  it('rejects ambiguous wall-clock input during fall-back', () => {
    expect(parseDateTimeInTimeZone('2026-11-01T01:30', 'America/New_York')).toBeNull();
  });

  it('resolves generated recurrence boundaries with Temporal-compatible DST semantics', () => {
    const spring = resolveLocalDateTimeInTimeZone(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      'America/New_York',
      'compatible'
    );
    expect(spring?.toISOString()).toBe('2026-03-08T07:30:00.000Z'); // 03:30 EDT

    const fallEarlier = resolveLocalDateTimeInTimeZone(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
      'America/New_York',
      'compatible'
    );
    const fallLater = resolveLocalDateTimeInTimeZone(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
      'America/New_York',
      'later'
    );
    expect(fallEarlier?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(fallLater?.toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it('handles 30-minute DST transitions without assuming a one-hour change', () => {
    expect(parseDateTimeInTimeZone('2026-10-04T02:15', 'Australia/Lord_Howe')).toBeNull();
    expect(parseDateTimeInTimeZone('2026-04-05T01:45', 'Australia/Lord_Howe')).toBeNull();

    const compatible = resolveLocalDateTimeInTimeZone(
      { year: 2026, month: 10, day: 4, hour: 2, minute: 15 },
      'Australia/Lord_Howe',
      'compatible'
    );
    expect(compatible?.toISOString()).toBe('2026-10-03T15:45:00.000Z'); // 02:45 +11
  });

  it('handles full-day political timezone jumps', () => {
    expect(parseDateTimeInTimeZone('2011-12-30T12:00', 'Pacific/Apia')).toBeNull();

    const compatible = resolveLocalDateTimeInTimeZone(
      { year: 2011, month: 12, day: 30, hour: 12, minute: 0 },
      'Pacific/Apia',
      'compatible'
    );
    expect(compatible?.toISOString()).toBe('2011-12-30T22:00:00.000Z'); // 2011-12-31 12:00 +14
  });

  it('rejects invalid calendar values instead of normalizing them', () => {
    expect(parseDateTimeInTimeZone('2026-02-30T10:00', 'UTC')).toBeNull();
    expect(parseDateTimeInTimeZone('2026-13-01T10:00', 'UTC')).toBeNull();
    expect(parseDateTimeInTimeZone('2026-01-01T24:00', 'UTC')).toBeNull();
  });
});
