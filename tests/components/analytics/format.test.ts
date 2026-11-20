import { describe, expect, it } from 'vitest';
import {
  describeDelta,
  formatBucket,
  formatDuration,
  formatMetric,
} from '@/components/analytics/format';

describe('analytics formatting', () => {
  it('formats durations compactly and never shows 60m or 24h remainders', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(12 * 60_000)).toBe('12m');
    expect(formatDuration(3 * 3_600_000 + 20 * 60_000)).toBe('3h 20m');
    expect(formatDuration(2 * 3_600_000 - 1_000)).toBe('2h');
    expect(formatDuration(2 * 86_400_000 + 4 * 3_600_000)).toBe('2d 4h');
  });

  it('formats metrics by unit with an em dash for no data', () => {
    expect(formatMetric(null, 'percent')).toBe('—');
    expect(formatMetric(100, 'percent')).toBe('100%');
    expect(formatMetric(92.345, 'percent')).toBe('92.3%');
    expect(formatMetric(1234, 'count')).toBe('1,234');
    expect(formatMetric(2.25, 'ratio')).toBe('2.3');
  });

  it('colours deltas by which direction is better', () => {
    expect(describeDelta(120, 100, 'count', 'down')).toEqual({
      label: '+20%',
      tone: 'bad',
      direction: 'up',
    });
    expect(describeDelta(80, 100, 'duration', 'down')?.tone).toBe('good');
    expect(describeDelta(95, 92, 'percent', 'up')).toEqual({
      label: '+3.0 pts',
      tone: 'good',
      direction: 'up',
    });
    expect(describeDelta(5, 0, 'count', 'down')).toBeNull();
    expect(describeDelta(null, 3, 'count', 'down')).toBeNull();
    expect(describeDelta(100.2, 100, 'count', 'down')?.label).toBe('No change');
  });

  it('labels buckets without shifting timezones', () => {
    expect(formatBucket('2026-11-20T00:00:00', 'day')).toBe('Nov 20');
    expect(formatBucket('2026-11-20T13:00:00', 'hour')).toBe('13:00');
    expect(formatBucket('2026-11-01T00:00:00', 'month')).toBe('Nov 2026');
  });
});
