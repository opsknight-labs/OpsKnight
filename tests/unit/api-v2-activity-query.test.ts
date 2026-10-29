import { describe, expect, it } from 'vitest';
import {
  buildApiActivityWhere,
  encodeActivityCursor,
  parseApiActivityFilters,
} from '@/lib/api-v2/activity-query';

describe('API activity query', () => {
  it('always scopes to API-gateway audit rows in the database', () => {
    const where = buildApiActivityWhere({}) as { AND: Array<Record<string, unknown>> };
    expect(where.AND[0]).toEqual({
      OR: [
        { action: { startsWith: 'api_key.' } },
        { action: { startsWith: 'service_account' } },
        { details: { path: ['metadata', 'apiGateway'], equals: 'api_v2' } },
        { details: { path: ['apiGateway'], equals: 'api_v2' } },
      ],
    });
  });

  it('turns URL params into database filters, ignoring malformed input', () => {
    const filters = parseApiActivityFilters({
      q: ' incident. ',
      entity: 'INCIDENT',
      actor: 'oncall',
      key: 'key_1',
      from: '2026-10-01',
      to: 'not-a-date',
      cursor: '%%%',
    });
    expect(filters).toMatchObject({ action: 'incident.', entityType: 'INCIDENT', actor: 'oncall' });
    expect(filters.from?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(filters.to).toBeUndefined();
    expect(filters.cursor).toBeUndefined();
  });

  it('drops unknown resource types instead of failing the query', () => {
    const where = buildApiActivityWhere({ entityType: 'NOT_A_TYPE' }) as { AND: unknown[] };
    expect(where.AND).toHaveLength(1);
  });

  it('round-trips a keyset cursor and applies it as (createdAt, id) < cursor', () => {
    const row = { createdAt: new Date('2026-10-14T10:00:00.000Z'), id: 'audit_9' };
    const parsed = parseApiActivityFilters({ cursor: encodeActivityCursor(row) });
    expect(parsed.cursor).toEqual(row);

    const where = buildApiActivityWhere(parsed) as { AND: Array<Record<string, unknown>> };
    expect(where.AND[1]).toEqual({
      OR: [
        { createdAt: { lt: row.createdAt } },
        { createdAt: row.createdAt, id: { lt: 'audit_9' } },
      ],
    });
  });

  it('pushes actor, key and date range filters into the query', () => {
    const where = buildApiActivityWhere(
      parseApiActivityFilters({ actor: 'sa', key: 'key_2', from: '2026-10-01', to: '2026-10-02' })
    ) as { AND: Array<Record<string, unknown>> };
    expect(where.AND).toContainEqual({
      OR: [
        { details: { path: ['metadata', 'apiClientId'], equals: 'key_2' } },
        { details: { path: ['apiClientId'], equals: 'key_2' } },
      ],
    });
    expect(where.AND).toContainEqual({
      createdAt: {
        gte: new Date('2026-10-01T00:00:00.000Z'),
        lte: new Date('2026-10-02T23:59:59.999Z'),
      },
    });
  });
});
