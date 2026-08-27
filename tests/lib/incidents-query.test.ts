import { describe, expect, it } from 'vitest';
import {
  buildIncidentOrderBy,
  buildIncidentWhere,
  normalizeIncidentFilter,
  normalizeIncidentSort,
  normalizeIncidentStatus,
} from '@/lib/incidents-query';

describe('incidents-query helpers', () => {
  it('normalizes invalid filters and sorts to defaults', () => {
    expect(normalizeIncidentFilter('unknown')).toBe('all');
    expect(normalizeIncidentSort('unknown')).toBe('newest');
  });

  it('keeps valid filters and sorts intact', () => {
    expect(normalizeIncidentFilter('mine')).toBe('mine');
    expect(normalizeIncidentFilter('acknowledged')).toBe('acknowledged');
    expect(normalizeIncidentFilter('open')).toBe('open');
    expect(normalizeIncidentSort('updated')).toBe('updated');
  });

  it('builds acknowledged and open filters correctly', () => {
    const ackWhere = buildIncidentWhere({ filter: 'acknowledged' });
    expect(ackWhere).toEqual({ status: 'ACKNOWLEDGED' });

    const openWhere = buildIncidentWhere({ filter: 'open' });
    expect(openWhere).toEqual({ status: 'OPEN' });
  });

  it('builds mine filter with assignee and open-only status', () => {
    const where = buildIncidentWhere({
      filter: 'mine',
      assigneeId: 'user-1',
    });

    expect(where).toEqual({
      assigneeId: 'user-1',
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
    });
  });

  it('normalizes only supported strict incident statuses', () => {
    expect(normalizeIncidentStatus('ACKNOWLEDGED')).toBe('ACKNOWLEDGED');
    expect(normalizeIncidentStatus('ACTIVE')).toBeUndefined();
  });

  it('supports strict status, assignee, and service drill-down filters', () => {
    expect(
      buildIncidentWhere({
        filter: 'all',
        status: 'ACKNOWLEDGED',
        assignee: 'unassigned',
        serviceId: 'service-1',
      })
    ).toEqual({
      status: 'ACKNOWLEDGED',
      assigneeId: null,
      serviceId: 'service-1',
    });
  });

  it('applies historical metric date bounds', () => {
    const createdAfter = new Date('2026-08-01T00:00:00.000Z');
    const createdBefore = new Date('2026-08-26T00:00:00.000Z');
    expect(buildIncidentWhere({ filter: 'all', createdAfter, createdBefore }).createdAt).toEqual({
      gte: createdAfter,
      lte: createdBefore,
    });
  });

  it('adds search, priority, and urgency filters', () => {
    const where = buildIncidentWhere({
      filter: 'resolved',
      search: 'db',
      priority: 'P1',
      urgency: 'HIGH',
    });

    expect(where.status).toBe('RESOLVED');
    expect(where.priority).toBe('P1');
    expect(where.urgency).toBe('HIGH');
    expect(where.OR).toEqual([
      { title: { contains: 'db', mode: 'insensitive' } },
      { description: { contains: 'db', mode: 'insensitive' } },
      { id: { contains: 'db', mode: 'insensitive' } },
    ]);
  });

  it('builds expected sort order', () => {
    expect(buildIncidentOrderBy('newest')).toEqual([{ createdAt: 'desc' }]);
    expect(buildIncidentOrderBy('oldest')).toEqual([{ createdAt: 'asc' }]);
    expect(buildIncidentOrderBy('updated')).toEqual([{ updatedAt: 'desc' }]);
    expect(buildIncidentOrderBy('status')).toEqual([{ status: 'asc' }]);
    expect(buildIncidentOrderBy('priority')).toEqual([
      { priority: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'desc' },
    ]);
  });
});
