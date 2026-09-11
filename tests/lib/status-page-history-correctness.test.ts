import { describe, expect, it } from 'vitest';
import {
  buildServiceHealthSegments,
  serviceUptimePercent,
} from '@/lib/status-pages/availability-engine';
import { buildPublicHistoryDays } from '@/lib/status-pages/history-presentation';
import type { PublicStatusHistory } from '@/lib/status-pages/public-contract';

const day0 = new Date('2026-09-09T00:00:00.000Z');
const day1 = new Date('2026-09-10T00:00:00.000Z');

function historyFrom(
  start: Date,
  end: Date,
  coverage: 'COMPLETE' | 'PARTIAL',
  incidents: Parameters<typeof buildServiceHealthSegments>[0]['incidents'],
  maintenance: Parameters<typeof buildServiceHealthSegments>[0]['maintenance'] = []
): PublicStatusHistory {
  const segments = buildServiceHealthSegments({
    serviceId: 'api',
    incidents,
    maintenance,
    start,
    end,
  });
  return {
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
    coverage,
    segments: segments.map(segment => ({
      startAt: new Date(segment.start).toISOString(),
      endAt: new Date(segment.end).toISOString(),
      status: segment.status,
    })),
  };
}

describe('history engine correctness', () => {
  it('resolves the worst status when incidents overlap within a day', () => {
    const history = historyFrom(day0, day1, 'COMPLETE', [
      {
        serviceId: 'api',
        status: 'RESOLVED',
        urgency: 'LOW',
        createdAt: new Date('2026-09-09T10:00:00Z'),
        resolvedAt: new Date('2026-09-09T12:00:00Z'),
      },
      {
        serviceId: 'api',
        status: 'RESOLVED',
        urgency: 'HIGH',
        createdAt: new Date('2026-09-09T11:00:00Z'),
        resolvedAt: new Date('2026-09-09T11:30:00Z'),
      },
    ]);
    expect(buildPublicHistoryDays(history, 'UTC')[0]?.status).toBe('MAJOR_OUTAGE');
  });

  it('shows an incident spanning local midnight on both days', () => {
    const history = historyFrom(day0, new Date('2026-09-11T00:00:00Z'), 'COMPLETE', [
      {
        serviceId: 'api',
        status: 'RESOLVED',
        urgency: 'HIGH',
        createdAt: new Date('2026-09-09T23:30:00Z'),
        resolvedAt: new Date('2026-09-10T00:30:00Z'),
      },
    ]);
    const days = buildPublicHistoryDays(history, 'UTC');
    expect(days.find(day => day.date === '2026-09-09')?.status).toBe('MAJOR_OUTAGE');
    expect(days.find(day => day.date === '2026-09-10')?.status).toBe('MAJOR_OUTAGE');
  });

  it('never turns complete, incident-free coverage into anything but operational at 100%', () => {
    const history = historyFrom(day0, day1, 'COMPLETE', []);
    const [day] = buildPublicHistoryDays(history, 'UTC');
    expect(day).toMatchObject({ status: 'OPERATIONAL', availabilityPercent: 100 });
  });

  it('reports partial coverage as unknown, never a fabricated green', () => {
    const history: PublicStatusHistory = {
      rangeStart: day0.toISOString(),
      rangeEnd: day1.toISOString(),
      coverage: 'PARTIAL',
      segments: [],
    };
    const [day] = buildPublicHistoryDays(history, 'UTC');
    expect(day).toMatchObject({ status: 'UNKNOWN', availabilityPercent: null });
  });

  it('clips incidents that resolved before the retention window start', () => {
    const cutoff = new Date('2026-09-09T06:00:00Z');
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
      start: cutoff,
      end: day1,
    });
    expect(segments).toEqual([]);
  });

  it('keeps daily availability and windowed uptime in agreement', () => {
    // 2h HIGH outage in a 24h day ΓçÆ 91.667% both ways.
    const incidents = [
      {
        serviceId: 'api',
        status: 'RESOLVED',
        urgency: 'HIGH' as const,
        createdAt: new Date('2026-09-09T08:00:00Z'),
        resolvedAt: new Date('2026-09-09T10:00:00Z'),
      },
    ];
    const history = historyFrom(day0, day1, 'COMPLETE', incidents);
    const segments = buildServiceHealthSegments({
      serviceId: 'api',
      incidents,
      maintenance: [],
      start: day0,
      end: day1,
    });
    const dayAvailability = buildPublicHistoryDays(history, 'UTC')[0]?.availabilityPercent;
    const windowUptime = serviceUptimePercent(segments, day0, day1);
    expect(dayAvailability).toBeCloseTo(windowUptime ?? 0, 3);
    expect(windowUptime).toBeCloseTo((22 / 24) * 100, 5);
  });
});
