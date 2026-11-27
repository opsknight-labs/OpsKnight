import { describe, expect, it } from 'vitest';
import { formatTimeMinutes, formatTimeMinutesMs } from '@/lib/time-format';

describe('formatTimeMinutes', () => {
  it('never prints 60 minutes in a unit', () => {
    expect(formatTimeMinutes(59.6)).toBe('1h');
    expect(formatTimeMinutes(119.6)).toBe('2h');
    expect(formatTimeMinutes(1439.7)).toBe('1d');
    expect(formatTimeMinutes(1499.6)).toBe('1d 1h');
  });

  it('keeps the existing shapes', () => {
    expect(formatTimeMinutes(0.4)).toBe('< 1 min');
    expect(formatTimeMinutes(12.2)).toBe('12 min');
    expect(formatTimeMinutes(125)).toBe('2h 5m');
    expect(formatTimeMinutes(1440 + 13 * 60 + 7)).toBe('1d 13h 7m');
    expect(formatTimeMinutesMs(null)).toBe('--');
    expect(formatTimeMinutesMs(119.6 * 60_000)).toBe('2h');
  });
});
