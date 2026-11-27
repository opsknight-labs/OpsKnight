import { describe, expect, it } from 'vitest';
import { isWindowActiveAt } from '@/lib/intelligence/noise-controls/recurrence';

/**
 * A repeating maintenance window with no COUNT or UNTIL repeats for as long as it is enabled. A window
 * created a long time ago must still hold today.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Every day 02:00 to 04:00 UTC, first created on 2024-01-01.
const dailyStart = new Date('2024-01-01T02:00:00Z');
const dailyEnd = new Date(dailyStart.getTime() + 2 * HOUR);
const daily = { startsAt: dailyStart, endsAt: dailyEnd, recurrence: 'FREQ=DAILY' };
// Every Saturday and Sunday 00:00 to 06:00 UTC, first created on 2024-01-06 (a Saturday).
const weekendStart = new Date('2024-01-06T00:00:00Z');
const weekend = {
  startsAt: weekendStart,
  endsAt: new Date(weekendStart.getTime() + 6 * HOUR),
  recurrence: 'FREQ=WEEKLY;BYDAY=SA,SU',
};

describe('repeating windows keep working however old they are', () => {
  it.each([
    ['one week', 7],
    ['one year', 366],
    ['two years', 731],
    ['five years', 1826],
  ])('a daily window created %s ago still holds at 03:00 today', (_label, days) => {
    const now = new Date(dailyStart.getTime() + days * DAY + HOUR); // 03:00 UTC
    expect(isWindowActiveAt(daily, now)).toBe(true);
  });

  it('and does not hold outside its hours', () => {
    const now = new Date(dailyStart.getTime() + 800 * DAY + 3 * HOUR); // 05:00 UTC
    expect(isWindowActiveAt(daily, now)).toBe(false);
  });

  it.each([
    ['six months', 26],
    ['two years', 104],
    ['five years', 260],
  ])('a weekend window created %s ago still holds on a Saturday', (_label, weeks) => {
    const saturday = new Date(weekendStart.getTime() + weeks * 7 * DAY + HOUR);
    expect(isWindowActiveAt(weekend, saturday)).toBe(true);
    const monday = new Date(saturday.getTime() + 2 * DAY);
    expect(isWindowActiveAt(weekend, monday)).toBe(false);
  });
});

describe('window edges', () => {
  it('holds from its first instant and ends at its last', () => {
    const oneOff = { startsAt: dailyStart, endsAt: dailyEnd, recurrence: null };
    expect(isWindowActiveAt(oneOff, dailyStart)).toBe(true);
    expect(isWindowActiveAt(oneOff, new Date(dailyStart.getTime() - 1))).toBe(false);
    expect(isWindowActiveAt(oneOff, dailyEnd)).toBe(true);
    expect(isWindowActiveAt(oneOff, new Date(dailyEnd.getTime() + 1))).toBe(false);
  });

  it('an overnight window that crosses midnight UTC holds on both sides of it', () => {
    const start = new Date('2026-03-01T22:00:00Z');
    const overnight = {
      startsAt: start,
      endsAt: new Date(start.getTime() + 6 * HOUR),
      recurrence: 'FREQ=DAILY',
    };
    expect(isWindowActiveAt(overnight, new Date('2026-03-10T23:30:00Z'))).toBe(true);
    expect(isWindowActiveAt(overnight, new Date('2026-03-11T02:00:00Z'))).toBe(true);
    expect(isWindowActiveAt(overnight, new Date('2026-03-11T05:00:00Z'))).toBe(false);
  });

  it('stops after COUNT occurrences and after UNTIL', () => {
    const counted = { ...daily, recurrence: 'FREQ=DAILY;COUNT=3' };
    expect(isWindowActiveAt(counted, new Date(dailyStart.getTime() + 2 * DAY + HOUR))).toBe(true);
    expect(isWindowActiveAt(counted, new Date(dailyStart.getTime() + 3 * DAY + HOUR))).toBe(false);
    const until = { ...daily, recurrence: 'FREQ=DAILY;UNTIL=20240110T000000Z' };
    expect(isWindowActiveAt(until, new Date('2024-01-09T03:00:00Z'))).toBe(true);
    expect(isWindowActiveAt(until, new Date('2024-01-11T03:00:00Z'))).toBe(false);
  });

  it('a monthly window on the 31st skips months that have no 31st', () => {
    const start = new Date('2026-01-31T01:00:00Z');
    const monthly = {
      startsAt: start,
      endsAt: new Date(start.getTime() + 2 * HOUR),
      recurrence: 'FREQ=MONTHLY',
    };
    expect(isWindowActiveAt(monthly, new Date('2026-03-31T02:00:00Z'))).toBe(true);
    expect(isWindowActiveAt(monthly, new Date('2026-02-28T02:00:00Z'))).toBe(false);
  });
});
