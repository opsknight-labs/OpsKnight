import type { Prisma } from '@prisma/client';

export const KEY_INVENTORY_PAGE_SIZE = 25;
export const KEY_STATUS_FILTERS = ['ALL', 'ACTIVE', 'REVOKED', 'EXPIRED'] as const;
export type KeyStatusFilter = (typeof KEY_STATUS_FILTERS)[number];

export type KeyInventoryFilters = {
  q?: string;
  status: KeyStatusFilter;
  cursor?: { createdAt: Date; id: string };
};

type RawParams = Record<string, string | string[] | undefined>;

function first(params: RawParams, key: string): string | undefined {
  // eslint-disable-next-line security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name
  const value = params[key];
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

export function encodeInventoryCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeInventoryCursor(value: string | undefined): KeyInventoryFilters['cursor'] {
  if (!value) return undefined;
  try {
    const [iso, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso);
    return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : undefined;
  } catch {
    return undefined;
  }
}

export function parseKeyInventoryFilters(params: RawParams): KeyInventoryFilters {
  const status = (first(params, 'kstatus') ?? 'ALL').toUpperCase();
  return {
    q: first(params, 'kq'),
    status: (KEY_STATUS_FILTERS as readonly string[]).includes(status)
      ? (status as KeyStatusFilter)
      : 'ALL',
    cursor: decodeInventoryCursor(first(params, 'kcursor')),
  };
}

/** Where-clause for the API key inventory, evaluated in the database. */
export function buildKeyInventoryWhere(
  scope: { userId?: string },
  filters: KeyInventoryFilters,
  now: Date = new Date()
): Prisma.ApiKeyWhereInput {
  const and: Prisma.ApiKeyWhereInput[] = [];
  if (scope.userId) and.push({ userId: scope.userId });
  if (filters.q) {
    and.push({
      OR: [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { prefix: { contains: filters.q, mode: 'insensitive' } },
        { user: { email: { contains: filters.q, mode: 'insensitive' } } },
      ],
    });
  }
  if (filters.status === 'ACTIVE') {
    and.push({ revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });
  } else if (filters.status === 'REVOKED') {
    and.push({ revokedAt: { not: null } });
  } else if (filters.status === 'EXPIRED') {
    and.push({ revokedAt: null, expiresAt: { lte: now } });
  }
  if (filters.cursor) {
    and.push({
      OR: [
        { createdAt: { lt: filters.cursor.createdAt } },
        { createdAt: filters.cursor.createdAt, id: { lt: filters.cursor.id } },
      ],
    });
  }
  return and.length > 0 ? { AND: and } : {};
}
