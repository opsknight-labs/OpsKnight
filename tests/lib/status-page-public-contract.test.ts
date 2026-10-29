import { describe, expect, it } from 'vitest';
import { aggregatePublicRegions, buildPublicHistorySegments } from '@/lib/status-pages/history';
import { buildPublicHistoryDays } from '@/lib/status-pages/history-presentation';
import { parsePublicStatusPageSnapshot } from '@/lib/status-pages/public-contract-schema';
import { getWorstPublicStatus, normalizePublicStatus, publicStatusForIncidentUrgency } from '@/lib/status-pages/status-presentation';

const rangeStart = '2026-09-09T00:00:00.000Z';
const rangeEnd = '2026-09-11T00:00:00.000Z';

describe('canonical public status contract', () => {
  it('never converts malformed, missing or mixed unknown status to operational', () => {
    expect(normalizePublicStatus(undefined)).toBe('UNKNOWN');
    expect(getWorstPublicStatus([])).toBe('UNKNOWN');
    expect(getWorstPublicStatus(['OPERATIONAL', 'UNKNOWN'])).toBe('UNKNOWN');
  });

  it('uses one monotonic urgency policy', () => {
    expect(publicStatusForIncidentUrgency('LOW')).toBe('DEGRADED');
    expect(publicStatusForIncidentUrgency('MEDIUM')).toBe('PARTIAL_OUTAGE');
    expect(publicStatusForIncidentUrgency('HIGH')).toBe('MAJOR_OUTAGE');
    expect(publicStatusForIncidentUrgency('other')).toBe('UNKNOWN');
  });

  it('publishes merged UTC non-operational segments without incident details', () => {
    const segments = buildPublicHistorySegments({ serviceId: 'api', start: new Date(rangeStart), end: new Date(rangeEnd), maintenance: [], incidents: [
      { serviceId: 'api', status: 'RESOLVED', urgency: 'LOW', createdAt: new Date('2026-09-09T12:00:00Z'), resolvedAt: new Date('2026-09-09T13:00:00Z') },
      { serviceId: 'api', status: 'RESOLVED', urgency: 'HIGH', createdAt: new Date('2026-09-09T12:30:00Z'), resolvedAt: new Date('2026-09-09T14:00:00Z') },
    ] });
    expect(segments).toEqual([
      { startAt: '2026-09-09T12:00:00.000Z', endAt: '2026-09-09T12:30:00.000Z', status: 'DEGRADED' },
      { startAt: '2026-09-09T12:30:00.000Z', endAt: '2026-09-09T14:00:00.000Z', status: 'MAJOR_OUTAGE' },
    ]);
    expect(Object.keys(segments[0] ?? {}).sort()).toEqual(['endAt', 'startAt', 'status']);
  });

  it('projects the same UTC segment onto each viewer local calendar', () => {
    const history = { rangeStart, rangeEnd, coverage: 'COMPLETE' as const, segments: [{ startAt: '2026-09-09T18:45:00.000Z', endAt: '2026-09-09T19:30:00.000Z', status: 'DEGRADED' as const }] };
    expect(buildPublicHistoryDays(history, 'Asia/Kolkata').find(day => day.status === 'DEGRADED')?.date).toBe('2026-09-10');
    expect(buildPublicHistoryDays(history, 'America/New_York').find(day => day.status === 'DEGRADED')?.date).toBe('2026-09-09');
  });

  it('supports 25-hour fallback and 23-hour spring-forward browser days', () => {
    const complete = (start: string, end: string) => ({ rangeStart: start, rangeEnd: end, coverage: 'COMPLETE' as const, segments: [] });
    expect(buildPublicHistoryDays(complete('2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'), 'America/New_York')[0]?.timeline).toEqual([{ startMinute: 0, endMinute: 1500, status: 'OPERATIONAL' }]);
    expect(buildPublicHistoryDays(complete('2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z'), 'America/New_York')[0]?.timeline).toEqual([{ startMinute: 0, endMinute: 1380, status: 'OPERATIONAL' }]);
  });

  it('renders partial coverage gaps as unknown', () => {
    const day = buildPublicHistoryDays({ rangeStart, rangeEnd: '2026-09-10T00:00:00Z', coverage: 'PARTIAL', segments: [] }, 'UTC')[0];
    expect(day).toMatchObject({ status: 'UNKNOWN', availabilityPercent: null });
    expect(day?.timeline).toEqual([{ startMinute: 0, endMinute: 1440, status: 'UNKNOWN' }]);
  });

  it('preserves maintenance availability and region aggregation', () => {
    const segments = buildPublicHistorySegments({ serviceId: 'api', incidents: [], maintenance: [{ startDate: new Date('2026-09-09T01:00:00Z'), endDate: new Date('2026-09-09T02:00:00Z'), affectedServiceIds: ['api'] }], start: new Date(rangeStart), end: new Date('2026-09-10T00:00:00Z') });
    const day = buildPublicHistoryDays({ rangeStart, rangeEnd: '2026-09-10T00:00:00Z', coverage: 'COMPLETE', segments }, 'UTC')[0];
    expect(day).toMatchObject({ status: 'MAINTENANCE', availabilityPercent: 100 });
    expect(aggregatePublicRegions([{ id: 'api', regions: ['us', 'eu'], status: 'DEGRADED' }])).toHaveLength(2);
  });

  it('rejects malformed and legacy snapshots instead of serving false green', () => {
    expect(parsePublicStatusPageSnapshot('page', { schemaVersion: 3, pageId: 'page' })).toBeNull();
    expect(parsePublicStatusPageSnapshot('page', { schemaVersion: 2, pageId: 'page', status: 'operational' })).toBeNull();
  });
});
