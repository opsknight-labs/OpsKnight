import { describe, expect, it } from 'vitest';
import {
  buildServiceHealthSegments,
  clipHealthSegments,
  healthAt,
  healthSegmentsToPublic,
  serviceAvailability,
  serviceUptimePercent,
} from '@/lib/status-pages/availability-engine';

const start = new Date('2026-09-09T00:00:00.000Z');
const end = new Date('2026-09-10T00:00:00.000Z'); // 24h window

describe('canonical availability engine', () => {
  it('derives uptime from the same segments that drive history', () => {
    const segments = buildServiceHealthSegments({
      serviceId: 'api',
      incidents: [
        {
          serviceId: 'api',
          status: 'RESOLVED',
          urgency: 'HIGH',
          createdAt: new Date('2026-09-09T01:00:00Z'),
          resolvedAt: new Date('2026-09-09T02:00:00Z'),
        },
      ],
      maintenance: [],
      start,
      end,
    });
    expect(healthSegmentsToPublic(segments)).toEqual([
      {
        startAt: '2026-09-09T01:00:00.000Z',
        endAt: '2026-09-09T02:00:00.000Z',
        status: 'MAJOR_OUTAGE',
      },
    ]);
    // 1h down out of 24h ΓçÆ 95.833%, computed from the identical interval set.
    expect(serviceUptimePercent(segments, start, end)).toBeCloseTo((23 / 24) * 100, 5);
  });

  it('treats maintenance as availability, not downtime', () => {
    const segments = buildServiceHealthSegments({
      serviceId: 'api',
      incidents: [],
      maintenance: [
        {
          startDate: new Date('2026-09-09T03:00:00Z'),
          endDate: new Date('2026-09-09T05:00:00Z'),
          affectedServiceIds: ['api'],
        },
      ],
      start,
      end,
    });
    expect(healthSegmentsToPublic(segments)).toEqual([
      {
        startAt: '2026-09-09T03:00:00.000Z',
        endAt: '2026-09-09T05:00:00.000Z',
        status: 'MAINTENANCE',
      },
    ]);
    expect(serviceUptimePercent(segments, start, end)).toBe(100);
  });

  it('lets an incident outrank overlapping maintenance in both history and uptime', () => {
    const segments = buildServiceHealthSegments({
      serviceId: 'api',
      incidents: [
        {
          serviceId: 'api',
          status: 'OPEN',
          urgency: 'MEDIUM',
          createdAt: new Date('2026-09-09T04:00:00Z'),
          resolvedAt: new Date('2026-09-09T04:30:00Z'),
        },
      ],
      maintenance: [
        {
          startDate: new Date('2026-09-09T03:00:00Z'),
          endDate: new Date('2026-09-09T05:00:00Z'),
          affectedServiceIds: ['api'],
        },
      ],
      start,
      end,
    });
    expect(healthSegmentsToPublic(segments)).toEqual([
      {
        startAt: '2026-09-09T03:00:00.000Z',
        endAt: '2026-09-09T04:00:00.000Z',
        status: 'MAINTENANCE',
      },
      {
        startAt: '2026-09-09T04:00:00.000Z',
        endAt: '2026-09-09T04:30:00.000Z',
        status: 'PARTIAL_OUTAGE',
      },
      {
        startAt: '2026-09-09T04:30:00.000Z',
        endAt: '2026-09-09T05:00:00.000Z',
        status: 'MAINTENANCE',
      },
    ]);
    // Only the 30-minute partial outage is downtime; maintenance stays available.
    expect(serviceUptimePercent(segments, start, end)).toBeCloseTo((1 - 0.5 / 24) * 100, 5);
  });

  it('does not treat an empty affected-service list as "no services"', () => {
    const segments = buildServiceHealthSegments({
      serviceId: 'api',
      incidents: [],
      maintenance: [
        {
          startDate: new Date('2026-09-09T03:00:00Z'),
          endDate: new Date('2026-09-09T05:00:00Z'),
          affectedServiceIds: [],
        },
      ],
      start,
      end,
    });
    expect(healthSegmentsToPublic(segments)[0]?.status).toBe('MAINTENANCE');
  });

  it('never reports 100% availability for a fully UNKNOWN window', () => {
    const segments = buildServiceHealthSegments({
      serviceId: 'api',
      incidents: [
        {
          serviceId: 'api',
          status: 'OPEN',
          urgency: 'UNEXPECTED',
          createdAt: start,
          resolvedAt: end,
        },
      ],
      maintenance: [],
      start,
      end,
    });
    expect(healthSegmentsToPublic(segments)[0]?.status).toBe('UNKNOWN');
    expect(serviceUptimePercent(segments, start, end)).toBeNull();
  });

  it('uses current status from the same merged intervals as history', () => {
    const segments = buildServiceHealthSegments({
      serviceId: 'api',
      incidents: [
        {
          serviceId: 'api',
          status: 'OPEN',
          urgency: 'HIGH',
          createdAt: new Date('2026-09-09T20:00:00Z'),
          resolvedAt: null,
        },
      ],
      maintenance: [],
      start,
      end,
    });
    expect(healthAt(segments, end.getTime()).status).toBe('MAJOR_OUTAGE');
    expect(healthAt(segments, start.getTime()).status).toBe('OPERATIONAL');
  });

  it('clips wide segments to a sub-window without re-resolving status', () => {
    const wide = buildServiceHealthSegments({
      serviceId: 'api',
      incidents: [
        {
          serviceId: 'api',
          status: 'RESOLVED',
          urgency: 'LOW',
          createdAt: new Date('2026-09-08T23:00:00Z'),
          resolvedAt: new Date('2026-09-09T01:00:00Z'),
        },
      ],
      maintenance: [],
      start: new Date('2026-09-08T00:00:00Z'),
      end,
    });
    expect(healthSegmentsToPublic(clipHealthSegments(wide, start, end))).toEqual([
      {
        startAt: '2026-09-09T00:00:00.000Z',
        endAt: '2026-09-09T01:00:00.000Z',
        status: 'DEGRADED',
      },
    ]);
  });

  it('cannot improve reported availability by adding UNKNOWN coverage', () => {
    const known = buildServiceHealthSegments({
      serviceId: 'api',
      incidents: [
        {
          serviceId: 'api',
          status: 'RESOLVED',
          urgency: 'HIGH',
          createdAt: new Date('2026-09-09T01:00:00Z'),
          resolvedAt: new Date('2026-09-09T02:00:00Z'),
        },
      ],
      maintenance: [],
      start,
      end,
    });
    const mixed = buildServiceHealthSegments({
      serviceId: 'api',
      incidents: [
        {
          serviceId: 'api',
          status: 'RESOLVED',
          urgency: 'HIGH',
          createdAt: new Date('2026-09-09T01:00:00Z'),
          resolvedAt: new Date('2026-09-09T02:00:00Z'),
        },
        {
          serviceId: 'api',
          status: 'OPEN',
          urgency: 'UNEXPECTED',
          createdAt: new Date('2026-09-09T03:00:00Z'),
          resolvedAt: new Date('2026-09-09T05:00:00Z'),
        },
      ],
      maintenance: [],
      start,
      end,
    });
    const knownAvailability = serviceAvailability(known, start, end);
    const mixedAvailability = serviceAvailability(mixed, start, end);
    expect(knownAvailability.percentage).not.toBeNull();
    expect(mixedAvailability.unknownMs).toBe(2 * 3_600_000);
    expect(mixedAvailability.percentage!).toBeLessThanOrEqual(knownAvailability.percentage!);
  });

  it('never treats missing measured time as 100% availability', () => {
    expect(serviceAvailability([], start, start).percentage).toBeNull();
    expect(
      serviceUptimePercent(
        buildServiceHealthSegments({
          serviceId: 'api',
          incidents: [
            {
              serviceId: 'api',
              status: 'OPEN',
              urgency: 'UNEXPECTED',
              createdAt: start,
              resolvedAt: end,
            },
          ],
          maintenance: [],
          start,
          end,
        }),
        start,
        end
      )
    ).toBeNull();
  });

  it('closes resolved incidents at updatedAt when resolvedAt is missing', () => {
    const segments = buildServiceHealthSegments({
      serviceId: 'api',
      incidents: [
        {
          serviceId: 'api',
          status: 'RESOLVED',
          urgency: 'HIGH',
          createdAt: new Date('2026-09-09T01:00:00Z'),
          resolvedAt: null,
          updatedAt: new Date('2026-09-09T02:00:00Z'),
        },
      ],
      maintenance: [],
      start,
      end,
    });
    expect(healthSegmentsToPublic(segments)).toEqual([
      {
        startAt: '2026-09-09T01:00:00.000Z',
        endAt: '2026-09-09T02:00:00.000Z',
        status: 'MAJOR_OUTAGE',
      },
    ]);
    expect(serviceUptimePercent(segments, start, end)).toBeCloseTo((23 / 24) * 100, 5);
  });

  it('reports Operational statusSince from the last recovered interval', () => {
    const segments = buildServiceHealthSegments({
      serviceId: 'api',
      incidents: [
        {
          serviceId: 'api',
          status: 'RESOLVED',
          urgency: 'HIGH',
          createdAt: new Date('2026-09-09T01:00:00Z'),
          resolvedAt: new Date('2026-09-09T02:00:00Z'),
        },
      ],
      maintenance: [],
      start,
      end,
    });
    expect(healthAt(segments, end.getTime())).toEqual({
      status: 'OPERATIONAL',
      statusSince: '2026-09-09T02:00:00.000Z',
    });
  });
});

describe('availability engine sweep-line scale', () => {
  it('merges 1k, 10k and 100k intervals well under quadratic time', () => {
    const windowStart = new Date('2026-01-01T00:00:00.000Z');
    const windowEnd = new Date('2026-12-31T00:00:00.000Z');
    const cases = [
      { count: 1_000, budgetMs: 500 },
      { count: 10_000, budgetMs: 1_500 },
      { count: 100_000, budgetMs: 8_000 },
    ] as const;
    for (const { count, budgetMs } of cases) {
      const incidents = Array.from({ length: count }, (_, index) => {
        const createdAt = new Date(windowStart.getTime() + (index % 50_000) * 60_000);
        return {
          serviceId: 'api',
          status: 'RESOLVED' as const,
          urgency: index % 3 === 0 ? 'HIGH' : index % 3 === 1 ? 'MEDIUM' : 'LOW',
          createdAt,
          resolvedAt: new Date(createdAt.getTime() + 5 * 60_000),
        };
      });
      const started = performance.now();
      const segments = buildServiceHealthSegments({
        serviceId: 'api',
        incidents,
        maintenance: [],
        start: windowStart,
        end: windowEnd,
      });
      const elapsed = performance.now() - started;
      expect(segments.length).toBeGreaterThan(0);
      expect(elapsed, `${count} intervals took ${elapsed}ms`).toBeLessThan(budgetMs);
    }
  });
});
