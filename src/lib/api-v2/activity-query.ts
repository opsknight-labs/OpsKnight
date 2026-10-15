import { AuditEntityType, type Prisma } from '@prisma/client';

export const API_ACTIVITY_PAGE_SIZE = 25;

export const API_ACTIVITY_ENTITY_TYPES = Object.values(AuditEntityType);

export type ApiActivityFilters = {
  /** Case-insensitive substring of the audit action, e.g. `incident.` */
  action?: string;
  entityType?: string;
  /** Substring of the actor email or name. */
  actor?: string;
  /** Exact API key id recorded on the event. */
  apiKeyId?: string;
  from?: Date;
  to?: Date;
  /** Keyset cursor: events strictly older than this (createdAt, id) pair. */
  cursor?: { createdAt: Date; id: string };
};

type RawParams = Record<string, string | string[] | undefined>;

function first(params: RawParams, key: string): string | undefined {
  const value = params[key];
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function encodeActivityCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeActivityCursor(value: string | undefined): ApiActivityFilters['cursor'] {
  if (!value) return undefined;
  try {
    const [iso, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}

export function parseApiActivityFilters(params: RawParams): ApiActivityFilters {
  return {
    action: first(params, 'q'),
    entityType: first(params, 'entity'),
    actor: first(params, 'actor'),
    apiKeyId: first(params, 'key'),
    from: parseDate(first(params, 'from')),
    to: parseDate(first(params, 'to'), true),
    cursor: decodeActivityCursor(first(params, 'cursor')),
  };
}

/**
 * Security audit history written by the API gateway, selected in the database so
 * a busy tenant cannot push API events out of a fixed-size window. This is audit
 * history of successful administrative operations, not an access log of requests.
 */
export function buildApiActivityWhere(filters: ApiActivityFilters): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [
    {
      OR: [
        { action: { startsWith: 'api_key.' } },
        { action: { startsWith: 'service_account' } },
        // emitAuditEvent stores caller details under `details.metadata`; the flat path covers
        // rows written before that envelope existed.
        { details: { path: ['metadata', 'apiGateway'], equals: 'api_v2' } },
        { details: { path: ['apiGateway'], equals: 'api_v2' } },
      ],
    },
  ];

  if (filters.action) and.push({ action: { contains: filters.action, mode: 'insensitive' } });
  if (filters.entityType && filters.entityType in AuditEntityType) {
    and.push({ entityType: filters.entityType as AuditEntityType });
  }
  if (filters.actor) {
    and.push({
      OR: [
        { actorEmail: { contains: filters.actor, mode: 'insensitive' } },
        { actorName: { contains: filters.actor, mode: 'insensitive' } },
      ],
    });
  }
  if (filters.apiKeyId) {
    and.push({
      OR: [
        { details: { path: ['metadata', 'apiClientId'], equals: filters.apiKeyId } },
        { details: { path: ['apiClientId'], equals: filters.apiKeyId } },
      ],
    });
  }
  if (filters.from || filters.to) {
    and.push({
      createdAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
    });
  }
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
