import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/retention-policy', () => ({
  getQueryDateBounds: vi.fn(),
  getReportingWindowForDays: vi.fn(async (days: number, _dataType: string, now: Date) => ({
    start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    end: now,
    isClipped: false,
  })),
}));
import {
  buildDateFilter,
  buildRetainedDateFilter,
  buildIncidentWhere,
  buildIncidentOrderBy,
  getDaysFromRange,
  getRangeLabel,
} from '@/lib/dashboard-utils';

describe('dashboard-utils', () => {
  describe('buildRetainedDateFilter', () => {
    it('keeps retention metadata outside the Prisma where object', async () => {
      const now = new Date('2026-08-28T13:07:49.809Z');
      const result = await buildRetainedDateFilter('30', undefined, undefined, now);

      expect(result.where).toEqual({
        createdAt: {
          gte: new Date('2026-07-29T13:07:49.809Z'),
          lte: now,
        },
      });
      expect(result.window).toEqual({
        start: new Date('2026-07-29T13:07:49.809Z'),
        end: now,
        isClipped: false,
      });
      expect(result.where).not.toHaveProperty('isClipped');
    });

    it('builds a Prisma-safe incident query from the retained filter', async () => {
      const retained = await buildRetainedDateFilter(
        '30',
        undefined,
        undefined,
        new Date('2026-08-28T13:07:49.809Z')
      );

      const where = buildIncidentWhere({ status: 'OPEN' }, { dateFilter: retained.where });

      expect(where).toEqual({
        createdAt: retained.where.createdAt,
        status: 'OPEN',
      });
      expect(where).not.toHaveProperty('isClipped');
      expect(Object.keys(where)).toEqual(['createdAt', 'status']);
    });

    it('retains default status and urgency behavior when a date filter is supplied', async () => {
      const retained = await buildRetainedDateFilter(
        '7',
        undefined,
        undefined,
        new Date('2026-08-28T13:07:49.809Z')
      );

      const where = buildIncidentWhere(
        { status: 'ACTIVE', urgency: 'HIGH' },
        { dateFilter: retained.where }
      );

      expect(where.status).toEqual({ in: ['OPEN', 'ACKNOWLEDGED'] });
      expect(where.urgency).toBe('HIGH');
    });
  });

  describe('buildDateFilter', () => {
    it('returns empty object when range is "all"', () => {
      const result = buildDateFilter('all');
      expect(result).toEqual({});
    });

    it('returns empty object when range is undefined', () => {
      const result = buildDateFilter(undefined);
      expect(result).toEqual({});
    });

    it('creates date filter for numeric range', () => {
      const result = buildDateFilter('7');
      expect(result.createdAt).toBeDefined();
      expect(result.createdAt?.gte).toBeInstanceOf(Date);
      expect(result.createdAt?.lte).toBeUndefined();
    });

    it('creates date filter for custom range', () => {
      const result = buildDateFilter('custom', '2024-01-01', '2024-01-31');
      expect(result.createdAt).toBeDefined();
      expect(result.createdAt?.gte).toEqual(new Date('2024-01-01'));
      expect(result.createdAt?.lte).toEqual(new Date('2024-01-31'));
    });
  });

  describe('buildIncidentWhere', () => {
    it('builds where clause with status filter', () => {
      const result = buildIncidentWhere({ status: 'OPEN', range: '30' });
      expect(result.status).toBe('OPEN');
    });

    it('maps ACTIVE to the canonical actionable statuses', () => {
      const result = buildIncidentWhere({ status: 'ACTIVE', range: '30' });
      expect(result.status).toEqual({ in: ['OPEN', 'ACKNOWLEDGED'] });
    });

    it('excludes status when includeStatus is false', () => {
      const result = buildIncidentWhere({ status: 'OPEN', range: '30' }, { includeStatus: false });
      expect(result.status).toBeUndefined();
    });

    it('sets assigneeId to null for empty assignee', () => {
      const result = buildIncidentWhere({ assignee: '', range: '30' });
      expect(result.assigneeId).toBeNull();
    });

    it('sets assigneeId for specific assignee', () => {
      const result = buildIncidentWhere({ assignee: 'user-123', range: '30' });
      expect(result.assigneeId).toBe('user-123');
    });

    it('includes urgency filter by default', () => {
      const result = buildIncidentWhere({ urgency: 'HIGH', range: '30' });
      expect(result.urgency).toBe('HIGH');
    });

    it('excludes urgency when includeUrgency is false', () => {
      const result = buildIncidentWhere(
        { urgency: 'HIGH', range: '30' },
        { includeUrgency: false }
      );
      expect(result.urgency).toBeUndefined();
    });
  });

  describe('buildIncidentOrderBy', () => {
    it('defaults to createdAt desc', () => {
      const result = buildIncidentOrderBy();
      expect(result).toEqual({ createdAt: 'desc' });
    });

    it('handles status sort', () => {
      const result = buildIncidentOrderBy('status', 'asc');
      expect(result).toEqual({ status: 'asc' });
    });

    it('handles urgency sort', () => {
      const result = buildIncidentOrderBy('urgency', 'desc');
      expect(result).toEqual({ urgency: 'desc' });
    });

    it('handles title sort', () => {
      const result = buildIncidentOrderBy('title', 'asc');
      expect(result).toEqual({ title: 'asc' });
    });
  });

  describe('getDaysFromRange', () => {
    it('returns 30 for "all" range', () => {
      expect(getDaysFromRange('all')).toBe(30);
    });

    it('returns 30 for undefined range', () => {
      expect(getDaysFromRange(undefined)).toBe(30);
    });

    it('parses numeric range', () => {
      expect(getDaysFromRange('7')).toBe(7);
      expect(getDaysFromRange('90')).toBe(90);
    });

    it('returns 30 for invalid range', () => {
      expect(getDaysFromRange('invalid')).toBe(30);
    });
  });

  describe('getRangeLabel', () => {
    it('returns (All Time) for "all"', () => {
      expect(getRangeLabel('all')).toBe('(All Time)');
    });

    it('returns (Custom) for "custom"', () => {
      expect(getRangeLabel('custom')).toBe('(Custom)');
    });

    it('returns correct labels for numeric ranges', () => {
      expect(getRangeLabel('7')).toBe('(7d)');
      expect(getRangeLabel('30')).toBe('(30d)');
      expect(getRangeLabel('90')).toBe('(90d)');
    });

    it('returns (All Time) for undefined', () => {
      expect(getRangeLabel(undefined)).toBe('(All Time)');
    });
  });
});
