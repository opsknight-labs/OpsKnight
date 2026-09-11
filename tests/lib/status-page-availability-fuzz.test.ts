import { describe, expect, it } from 'vitest';
import {
  buildServiceHealthSegments,
  healthSegmentsToPublic,
  serviceUptimePercent,
  type PublicHistoryIncident,
} from '@/lib/status-pages/availability-engine';

/** Deterministic PRNG so a failure is always reproducible from its seed. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const URGENCIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
const STATUSES = ['OPEN', 'RESOLVED', 'ACKNOWLEDGED', 'SUPPRESSED', 'SNOOZED'] as const;
const windowStart = new Date('2026-09-01T00:00:00.000Z');
const windowEnd = new Date('2026-10-01T00:00:00.000Z'); // 30 days
const spanMs = windowEnd.getTime() - windowStart.getTime();

function randomIncidents(rng: () => number, count: number): PublicHistoryIncident[] {
  return Array.from({ length: count }, () => {
    const a = windowStart.getTime() + Math.floor(rng() * spanMs);
    const b = windowStart.getTime() + Math.floor(rng() * spanMs);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    const resolved = rng() < 0.15 ? null : new Date(end); // some still open
    return {
      serviceId: 'api',
      createdAt: new Date(start),
      resolvedAt: resolved,
      urgency: URGENCIES[Math.floor(rng() * URGENCIES.length)]!,
      status: STATUSES[Math.floor(rng() * STATUSES.length)]!,
    };
  });
}

describe('availability engine ΓÇö property/fuzz invariants', () => {
  it('holds its invariants across pathological random incident sets', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = mulberry32(seed);
      const incidents = randomIncidents(rng, 1 + Math.floor(rng() * 40));
      const segments = buildServiceHealthSegments({
        serviceId: 'api',
        incidents,
        maintenance: [],
        start: windowStart,
        end: windowEnd,
      });

      // Segments are sorted, non-overlapping and never operational.
      let previousEnd = -Infinity;
      for (const segment of segments) {
        expect(segment.end).toBeGreaterThan(segment.start);
        expect(segment.start).toBeGreaterThanOrEqual(windowStart.getTime());
        expect(segment.end).toBeLessThanOrEqual(windowEnd.getTime());
        expect(segment.start).toBeGreaterThanOrEqual(previousEnd);
        expect(segment.status).not.toBe('OPERATIONAL');
        previousEnd = segment.end;
      }

      // Uptime always lands in [0, 100].
      const uptime = serviceUptimePercent(segments, windowStart, windowEnd);
      if (uptime === null) {
        expect(segments.every(segment => segment.status === 'UNKNOWN')).toBe(true);
        continue;
      }
      expect(uptime).toBeGreaterThanOrEqual(0);
      expect(uptime).toBeLessThanOrEqual(100);

      // No false green: any degraded/partial/major span means uptime is strictly below 100.
      const hasDowntime = segments.some(
        segment =>
          segment.status === 'DEGRADED' ||
          segment.status === 'PARTIAL_OUTAGE' ||
          segment.status === 'MAJOR_OUTAGE'
      );
      if (hasDowntime) expect(uptime).toBeLessThan(100);

      // Serialization stays valid and lossless in ordering.
      const publicSegments = healthSegmentsToPublic(segments);
      for (const segment of publicSegments) {
        expect(Date.parse(segment.startAt)).toBeLessThan(Date.parse(segment.endAt));
      }

      // Determinism: the same incidents ΓçÆ identical segments.
      const again = buildServiceHealthSegments({
        serviceId: 'api',
        incidents,
        maintenance: [],
        start: windowStart,
        end: windowEnd,
      });
      expect(again).toEqual(segments);
    }
  });
});
