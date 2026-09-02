import 'server-only';

import type {
  NotificationCategory,
  NotificationChannel,
  NotificationStatus,
  Prisma,
} from '@prisma/client';
import prisma from './prisma';

export const OPERATIONS_CHANNELS = [
  'EMAIL',
  'SMS',
  'PUSH',
  'SLACK',
  'WEBHOOK',
  'WHATSAPP',
] as const satisfies readonly NotificationChannel[];
export const OPERATIONS_STATUSES = [
  'PENDING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'SKIPPED',
] as const satisfies readonly NotificationStatus[];
export const OPERATIONS_CATEGORIES = [
  'INCIDENT',
  'SECURITY',
  'STATUS_PAGE',
  'SLA',
  'ADMINISTRATION',
  'SYSTEM',
] as const satisfies readonly NotificationCategory[];

type Cursor = { createdAt: string; id: string };

export type NotificationOperationsFilters = {
  channel?: NotificationChannel;
  status?: NotificationStatus;
  category?: NotificationCategory;
  query?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
};

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): { createdAt: Date; id: string } | null {
  if (!value || value.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
    const createdAt = new Date(parsed.createdAt || '');
    if (
      !parsed.id ||
      parsed.id.length > 191 ||
      !/^[A-Za-z0-9_-]+$/.test(parsed.id) ||
      !Number.isFinite(createdAt.getTime())
    ) {
      return null;
    }
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

export function redactNotificationError(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/https?:\/\/[^\s]+/gi, '[redacted url]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\+\d[\d ().-]{6,}\d/g, '[redacted phone]')
    .replace(/(token|secret|authorization|api[-_ ]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 1_000);
}

export async function getNotificationOperations(
  filters: NotificationOperationsFilters,
  now: Date = new Date()
) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cursor = decodeCursor(filters.cursor);
  const query = filters.query?.trim().slice(0, 120);
  const statusCondition =
    filters.status === 'SENT' || filters.status === 'DELIVERED'
      ? { in: ['SENT', 'DELIVERED'] as NotificationStatus[] }
      : filters.status
        ? filters.status
        : undefined;

  const baseFilters: Prisma.NotificationWhereInput = {
    ...(filters.channel ? { channel: filters.channel } : {}),
    createdAt: {
      gte: filters.from ?? defaultFrom,
      ...(filters.to ? { lte: filters.to } : {}),
    },
    ...(query
      ? {
          OR: [
            { message: { contains: query, mode: 'insensitive' } },
            { recipientDisplay: { contains: query, mode: 'insensitive' } },
            { sourceType: { contains: query, mode: 'insensitive' } },
            { sourceId: { contains: query, mode: 'insensitive' } },
            { incident: { title: { contains: query, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const statusStatsWhere: Prisma.NotificationWhereInput = {
    ...baseFilters,
    ...(filters.category ? { category: filters.category } : {}),
  };

  const categoryStatsWhere: Prisma.NotificationWhereInput = {
    ...baseFilters,
    ...(statusCondition ? { status: statusCondition } : {}),
  };

  const baseWhere: Prisma.NotificationWhereInput = {
    ...baseFilters,
    ...(statusCondition ? { status: statusCondition } : {}),
    ...(filters.category ? { category: filters.category } : {}),
  };

  const where: Prisma.NotificationWhereInput = {
    ...baseWhere,
    ...(cursor
      ? {
          AND: [
            {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : {}),
  };

  const [rows, statusGroups, categoryGroups] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        channel: true,
        status: true,
        category: true,
        recipientType: true,
        recipientDisplay: true,
        templateKey: true,
        sourceType: true,
        attempts: true,
        maxAttempts: true,
        priority: true,
        scheduledAt: true,
        nextAttemptAt: true,
        sentAt: true,
        deliveredAt: true,
        failedAt: true,
        errorMsg: true,
        createdAt: true,
        incident: { select: { id: true, title: true } },
        deliveryAttempts: {
          orderBy: { ordinal: 'desc' },
          take: 1,
          select: { outcome: true, latencyMs: true, startedAt: true },
        },
      },
    }),
    prisma.notification.groupBy({
      by: ['status'],
      where: statusStatsWhere,
      _count: { _all: true },
    }),
    prisma.notification.groupBy({
      by: ['category'],
      where: categoryStatsWhere,
      _count: { _all: true },
    }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  const byStatus = Object.fromEntries(OPERATIONS_STATUSES.map(status => [status, 0]));
  for (const group of statusGroups) byStatus[group.status] = group._count._all;
  const byCategory = Object.fromEntries(OPERATIONS_CATEGORIES.map(category => [category, 0]));
  for (const group of categoryGroups) byCategory[group.category] = group._count._all;

  return {
    notifications: page.map(row => ({
      ...row,
      errorMsg: redactNotificationError(row.errorMsg),
      payloadEncrypted: undefined,
      createdAt: row.createdAt.toISOString(),
      scheduledAt: row.scheduledAt.toISOString(),
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
      lastAttempt: row.deliveryAttempts[0]
        ? {
            ...row.deliveryAttempts[0],
            startedAt: row.deliveryAttempts[0].startedAt.toISOString(),
          }
        : null,
      deliveryAttempts: undefined,
    })),
    stats: { byStatus, byCategory },
    pagination: { limit, nextCursor, hasMore },
    range: {
      from: (filters.from ?? defaultFrom).toISOString(),
      to: filters.to?.toISOString() ?? null,
    },
  };
}
