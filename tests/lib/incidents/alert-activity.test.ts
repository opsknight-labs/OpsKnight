import { describe, expect, it } from 'vitest';
import { bucketCounts, pickBucketMinutes } from '@/lib/incidents/alert-activity';

const at = (minute: number) => Date.UTC(2026, 10, 23, 13, minute);

describe('alert activity bucketing', () => {
  it('picks a bucket that keeps the bar count readable', () => {
    expect(pickBucketMinutes(30 * 60_000)).toBe(1);
    expect(pickBucketMinutes(14 * 60 * 60_000)).toBe(15);
  });

  it('adds per-minute counts into graph buckets and drops points outside the range', () => {
    const points = [
      { ms: at(0), count: 2 },
      { ms: at(1), count: 1 },
      { ms: at(3), count: 4 },
      { ms: at(10), count: 1 },
      { ms: at(20), count: 9 },
    ];
    expect(bucketCounts(points, at(0), at(10), 2)).toEqual([3, 4, 0, 0, 1]);
  });
});
