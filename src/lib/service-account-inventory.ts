import type { Prisma } from '@prisma/client';
import { SERVICE_ACCOUNT_DOMAIN } from '@/lib/service-account-identity';
import { encodeInventoryCursor } from '@/lib/api-key-inventory';

export const SERVICE_ACCOUNT_PAGE_SIZE = 25;
export const SERVICE_ACCOUNT_ROLE_FILTERS = [
  'ALL',
  'ADMIN',
  'RESPONDER',
  'AUDITOR',
  'USER',
] as const;

export { encodeInventoryCursor };

export type ServiceAccountInventoryFilters = {
  q?: string;
  role: (typeof SERVICE_ACCOUNT_ROLE_FILTERS)[number];
  cursor?: { createdAt: Date; id: string };
};

type RawParams = Record<string, string | string[] | undefined>;

function first(params: RawParams, key: string): string | undefined {
  const value = params[key];
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

export function parseServiceAccountFilters(params: RawParams): ServiceAccountInventoryFilters {
  const role = (first(params, 'srole') ?? 'ALL').toUpperCase();
  let cursor: ServiceAccountInventoryFilters['cursor'];
  const raw = first(params, 'scursor');
  if (raw) {
    try {
      const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
      const createdAt = new Date(iso);
      if (id && !Number.isNaN(createdAt.getTime())) cursor = { createdAt, id };
    } catch {
      cursor = undefined;
    }
  }
  return {
    q: first(params, 'sq'),
    role: (SERVICE_ACCOUNT_ROLE_FILTERS as readonly string[]).includes(role)
      ? (role as ServiceAccountInventoryFilters['role'])
      : 'ALL',
    cursor,
  };
}

/** Service accounts are users with the reserved email domain; filtering runs in the database. */
export function buildServiceAccountWhere(
  filters: ServiceAccountInventoryFilters
): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [
    { email: { endsWith: `@${SERVICE_ACCOUNT_DOMAIN}`, mode: 'insensitive' } },
  ];
  if (filters.q) {
    and.push({
      OR: [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { email: { contains: filters.q, mode: 'insensitive' } },
      ],
    });
  }
  if (filters.role !== 'ALL') and.push({ role: filters.role });
  if (filters.cursor) {
    and.push({
      OR: [
        { createdAt: { lt: filters.cursor.createdAt } },
        { createdAt: filters.cursor.createdAt, id: { lt: filters.cursor.id } },
      ],
    });
  }
  return { AND: and };
}
