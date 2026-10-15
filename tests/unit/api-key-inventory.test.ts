import { describe, expect, it } from 'vitest';
import {
  buildKeyInventoryWhere,
  encodeInventoryCursor,
  parseKeyInventoryFilters,
} from '@/lib/api-key-inventory';

const now = new Date('2026-10-15T00:00:00.000Z');

describe('API key inventory query', () => {
  it('scopes non-admin viewers to their own keys', () => {
    expect(buildKeyInventoryWhere({ userId: 'u1' }, { status: 'ALL' }, now)).toEqual({
      AND: [{ userId: 'u1' }],
    });
    expect(buildKeyInventoryWhere({}, { status: 'ALL' }, now)).toEqual({});
  });

  it('computes status in the database, treating expired and revoked as distinct', () => {
    const where = (status: 'ACTIVE' | 'REVOKED' | 'EXPIRED') =>
      (buildKeyInventoryWhere({}, { status }, now) as { AND: unknown[] }).AND[0];
    expect(where('ACTIVE')).toEqual({
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    });
    expect(where('REVOKED')).toEqual({ revokedAt: { not: null } });
    expect(where('EXPIRED')).toEqual({ revokedAt: null, expiresAt: { lte: now } });
  });

  it('searches name, prefix and owner email', () => {
    const where = buildKeyInventoryWhere({}, { status: 'ALL', q: 'ci' }, now) as {
      AND: Array<{ OR: unknown[] }>;
    };
    expect(where.AND[0].OR).toHaveLength(3);
  });

  it('round-trips a keyset cursor and ignores malformed params', () => {
    const row = { createdAt: new Date('2026-10-14T10:00:00.000Z'), id: 'key_9' };
    const parsed = parseKeyInventoryFilters({
      kcursor: encodeInventoryCursor(row),
      kstatus: 'revoked',
      kq: ' ci ',
    });
    expect(parsed).toMatchObject({ status: 'REVOKED', q: 'ci', cursor: row });
    expect(parseKeyInventoryFilters({ kstatus: 'bogus', kcursor: '%%%' })).toEqual({
      q: undefined,
      status: 'ALL',
      cursor: undefined,
    });
  });
});
