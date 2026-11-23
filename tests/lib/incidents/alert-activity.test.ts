import { describe, expect, it } from 'vitest';
import {
  bucketTimes,
  pickBucketMinutes,
  summarizeAlertActivity,
} from '@/lib/incidents/alert-activity';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 23, 13, minute));

describe('summarizeAlertActivity', () => {
  it('counts firing alerts, severities, fingerprints and first/last seen', () => {
    const summary = summarizeAlertActivity(
      [
        { createdAt: at(0), status: 'TRIGGERED', severity: 'critical', fingerprintHash: 'a' },
        { createdAt: at(2), status: 'RESOLVED', severity: 'Critical', fingerprintHash: 'a' },
        { createdAt: at(5), status: 'TRIGGERED', severity: null, fingerprintHash: 'b' },
      ],
      3,
      'checkout-5xx'
    );
    expect(summary).toMatchObject({
      total: 3,
      truncated: false,
      firing: 2,
      fingerprints: 2,
      firstAt: at(0).toISOString(),
      lastAt: at(5).toISOString(),
      dedupKey: 'checkout-5xx',
    });
    expect(summary.severities).toEqual([
      { severity: 'critical', count: 2 },
      { severity: 'unspecified', count: 1 },
    ]);
  });

  it('keeps the exact total when the timestamps are capped', () => {
    const summary = summarizeAlertActivity(
      [{ createdAt: at(0), status: 'TRIGGERED', severity: null, fingerprintHash: null }],
      5000,
      null
    );
    expect(summary.total).toBe(5000);
    expect(summary.truncated).toBe(true);
  });
});

describe('bucketing', () => {
  it('picks a bucket that keeps the bar count readable', () => {
    expect(pickBucketMinutes(30 * 60_000)).toBe(1);
    expect(pickBucketMinutes(14 * 60 * 60_000)).toBe(15);
  });

  it('counts each time into its bucket and drops times outside the range', () => {
    const start = at(0).getTime();
    const end = at(10).getTime();
    const times = [at(0), at(1), at(3), at(10), at(20)].map(d => d.getTime());
    expect(bucketTimes(times, start, end, 2)).toEqual([2, 1, 0, 0, 1]);
  });
});
