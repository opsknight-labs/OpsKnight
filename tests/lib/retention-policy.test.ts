import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldUseRollups,
  getRealTimeWindowStart,
  getQueryDateBounds,
  getReportingWindowForDays,
  getPaginationRecommendation,
} from '@/lib/retention-policy';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  default: {
    systemSettings: {
      findUnique: vi.fn().mockResolvedValue({
        incidentRetentionDays: 730,
        alertRetentionDays: 365,
        logRetentionDays: 90,
        metricsRetentionDays: 365,
        realTimeWindowDays: 90,
      }),
      upsert: vi.fn(),
    },
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('retention-policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldUseRollups', () => {
    it('returns true only when the entire range is older than the real-time window', async () => {
      // start = 200 days ago, end = 100 days ago — both beyond 90-day window
      const start = new Date();
      start.setDate(start.getDate() - 200);
      const end = new Date();
      end.setDate(end.getDate() - 100);

      expect(await shouldUseRollups(start, end)).toBe(true);
    });

    it('returns false when range crosses the real-time boundary (the original >90-day bug)', async () => {
      // start = 180 days ago, end = now — this would have silently
      // routed to rollups before and dropped the last 90 days of data
      // because rollups don't exist for today.
      const start = new Date();
      start.setDate(start.getDate() - 180);

      expect(await shouldUseRollups(start, new Date())).toBe(false);
    });

    it('returns false for ranges entirely within the real-time window', async () => {
      const start = new Date();
      start.setDate(start.getDate() - 30);

      expect(await shouldUseRollups(start, new Date())).toBe(false);
    });

    it('returns false for current date with no end (defaults end to now)', async () => {
      expect(await shouldUseRollups(new Date())).toBe(false);
    });

    it('legacy single-arg call: returns false when start is historical but end defaults to now', async () => {
      // Backwards-compat: existing callers that pass only `start` should
      // get the safe answer (no rollups) rather than the broken old
      // behaviour where any historical start triggered rollup mode.
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      expect(await shouldUseRollups(oldDate)).toBe(false);
    });
  });

  describe('getRealTimeWindowStart', () => {
    it('returns date based on retention policy', async () => {
      const result = await getRealTimeWindowStart();
      const now = new Date();
      const expectedStart = new Date(now);
      expectedStart.setDate(expectedStart.getDate() - 90);

      // Within 1 day tolerance
      const diff = Math.abs(result.getTime() - expectedStart.getTime());
      expect(diff).toBeLessThan(24 * 60 * 60 * 1000);
    });
  });

  describe('getQueryDateBounds', () => {
    it('resolves relative periods from one injected clock', async () => {
      const now = new Date('2026-08-28T12:00:00.000Z');
      const result = await getReportingWindowForDays(7, 'incident', now);

      expect(result).toEqual({
        start: new Date('2026-08-21T12:00:00.000Z'),
        end: now,
        isClipped: false,
      });
    });

    it('clips start date to retention boundary', async () => {
      // Request 3 years ago (beyond 2 year retention)
      const oldStart = new Date();
      oldStart.setFullYear(oldStart.getFullYear() - 3);

      const result = await getQueryDateBounds(oldStart, undefined, 'incident');

      expect(result.isClipped).toBe(true);
      expect(result.start.getTime()).toBeGreaterThan(oldStart.getTime());
    });

    it('does not clip recent dates', async () => {
      const recentStart = new Date();
      recentStart.setDate(recentStart.getDate() - 30);

      const result = await getQueryDateBounds(recentStart, undefined, 'incident');

      expect(result.isClipped).toBe(false);
      expect(result.start.getTime()).toBe(recentStart.getTime());
    });

    it('defaults end date to now', async () => {
      const start = new Date();
      start.setDate(start.getDate() - 7);

      const before = Date.now();
      const result = await getQueryDateBounds(start, undefined);
      const after = Date.now();

      expect(result.end.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.end.getTime()).toBeLessThanOrEqual(after);
    });

    it('marks isClipped when end date is in the future (clock-skew safety)', async () => {
      // Future endDates (client clock drift, copy-paste of stale URL, etc.)
      // are silently clamped to now. Previously this clamp didn't set
      // `isClipped`, so the UI couldn't tell that the requested range
      // wasn't fully honored.
      const start = new Date();
      start.setDate(start.getDate() - 7);
      const futureEnd = new Date();
      futureEnd.setDate(futureEnd.getDate() + 5);

      const result = await getQueryDateBounds(start, futureEnd);

      expect(result.isClipped).toBe(true);
      expect(result.end.getTime()).toBeLessThan(futureEnd.getTime());
    });

    it('does not mark isClipped when end date is in the past', async () => {
      const start = new Date();
      start.setDate(start.getDate() - 14);
      const end = new Date();
      end.setDate(end.getDate() - 7);

      const result = await getQueryDateBounds(start, end);

      expect(result.isClipped).toBe(false);
      expect(result.end.getTime()).toBe(end.getTime());
    });
  });

  describe('getPaginationRecommendation', () => {
    it('recommends streaming for large date ranges', async () => {
      const start = new Date();
      start.setDate(start.getDate() - 365);
      const end = new Date();

      const result = await getPaginationRecommendation(start, end, 50); // 50 incidents/day

      expect(result.useStreamingAPI).toBe(true);
      expect(result.suggestedPageSize).toBeLessThanOrEqual(250);
    });

    it('does not recommend streaming for small datasets', async () => {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      const end = new Date();

      const result = await getPaginationRecommendation(start, end, 5); // 5 incidents/day = 35 total

      expect(result.useStreamingAPI).toBe(false);
    });

    it('recommends rollups for old date ranges', async () => {
      const start = new Date();
      start.setDate(start.getDate() - 180); // Beyond 90 day real-time window
      const end = new Date();

      const result = await getPaginationRecommendation(start, end);

      expect(result.useRollupData).toBe(true);
    });
  });
});
