import { NextRequest } from 'next/server';
import type { NotificationCategory, NotificationChannel, NotificationStatus } from '@prisma/client';
import { getCurrentUser } from '@/lib/rbac';
import {
  getNotificationOperations,
  OPERATIONS_CATEGORIES,
  OPERATIONS_CHANNELS,
  OPERATIONS_STATUSES,
} from '@/lib/notification-operations';
import { logger } from '@/lib/logger';
import { jsonError, jsonOk } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

function allowed<T extends string>(value: string | null, values: readonly T[]): T | undefined {
  return value && values.includes(value as T) ? (value as T) : undefined;
}

function dateParam(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return jsonError('Authentication required', 401);
  }
  if (user.role !== 'ADMIN' && user.role !== 'AUDITOR') {
    return jsonError('Admin or Auditor access required', 403);
  }

  const params = request.nextUrl.searchParams;
  const limit = Number.parseInt(params.get('limit') || '50', 10);
  const from = dateParam(params.get('from'));
  const to = dateParam(params.get('to'));
  const channel = allowed<NotificationChannel>(params.get('channel'), OPERATIONS_CHANNELS);
  const status = allowed<NotificationStatus>(params.get('status'), OPERATIONS_STATUSES);
  const category = allowed<NotificationCategory>(params.get('category'), OPERATIONS_CATEGORIES);
  if (
    (params.has('channel') && !channel) ||
    (params.has('status') && !status) ||
    (params.has('category') && !category)
  ) {
    return jsonError('Invalid notification operations filter', 400);
  }
  if ((params.has('from') && !from) || (params.has('to') && !to)) {
    return jsonError('Invalid date filter', 400);
  }
  if (from && to && from > to) {
    return jsonError('The start date must be before the end date', 400);
  }
  if (from && Date.now() - from.getTime() > 90 * 24 * 60 * 60 * 1000) {
    return jsonError('Operations queries are limited to 90 days', 400);
  }

  try {
    const result = await getNotificationOperations({
      channel,
      status,
      category,
      query: params.get('q') || undefined,
      cursor: params.get('cursor') || undefined,
      limit: Number.isFinite(limit) ? limit : 50,
      from,
      to,
    });
    return jsonOk(result, 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  } catch (error) {
    logger.error('api.admin.notifications.operations.failed', {
      actorId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Unable to load notification operations', 500);
  }
}
