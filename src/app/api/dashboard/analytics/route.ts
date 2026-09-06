import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  DashboardAnalyticsUnavailableError,
  getDashboardAnalytics,
  type DashboardAnalyticsFilters,
} from '@/lib/dashboard/dashboard-analytics-cache';
import { logger } from '@/lib/logger';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set([
  'range',
  'startDate',
  'endDate',
  'service',
  'assignee',
  'urgency',
  'status',
]);

function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) throw new Error(`Duplicate ${name} filter`);
  return values[0] || undefined;
}

function parseDate(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid ${name}`);
  return parsed;
}

function parseIdentifier(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  if (value.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function parseFilters(params: URLSearchParams): DashboardAnalyticsFilters {
  for (const key of params.keys()) {
    if (!ALLOWED.has(key)) throw new Error(`Unsupported filter: ${key}`);
  }
  const range = single(params, 'range') ?? '30';
  const startDate = parseDate(single(params, 'startDate'), 'startDate');
  const endDate = parseDate(single(params, 'endDate'), 'endDate');
  if ((startDate && !endDate) || (!startDate && endDate) || (startDate && endDate && startDate > endDate)) {
    throw new Error('Invalid custom date range');
  }
  if (range === 'custom' && (!startDate || !endDate)) {
    throw new Error('Custom range requires startDate and endDate');
  }
  const includeAllTime = range === 'all';
  const rangeDays = includeAllTime || range === 'custom' ? undefined : Number(range);
  if (rangeDays !== undefined && (!Number.isInteger(rangeDays) || rangeDays < 1 || rangeDays > 3650)) {
    throw new Error('Invalid range');
  }
  const urgencyValue = single(params, 'urgency');
  const urgency = urgencyValue && ['HIGH', 'MEDIUM', 'LOW'].includes(urgencyValue)
    ? (urgencyValue as 'HIGH' | 'MEDIUM' | 'LOW')
    : undefined;
  if (urgencyValue && !urgency) throw new Error('Invalid urgency');
  const statusValue = single(params, 'status');
  const statuses = ['ACTIVE', 'OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED', 'RESOLVED'] as const;
  const status = statusValue && statuses.includes(statusValue as (typeof statuses)[number])
    ? (statusValue as (typeof statuses)[number])
    : undefined;
  if (statusValue && !status) throw new Error('Invalid status');
  const serviceId = parseIdentifier(single(params, 'service'), 'service');
  const rawAssignee = single(params, 'assignee');
  const assignee = rawAssignee === 'unassigned' ? rawAssignee : parseIdentifier(rawAssignee, 'assignee');
  return {
    rangeDays,
    includeAllTime,
    startDate,
    endDate,
    serviceId,
    assigneeId: assignee === 'unassigned' ? null : assignee,
    urgency,
    status,
  };
}

export async function GET(request: Request) {
  const session = await getServerSession(await getAuthOptions());
  if (!session) return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));

  let filters: DashboardAnalyticsFilters;
  try {
    filters = parseFilters(new URL(request.url).searchParams);
  } catch (error) {
    return jsonError(
      new AppError({
        code: 'INCIDENT_INVALID_ARGUMENT',
        userMessage: error instanceof Error ? error.message : 'Invalid filters',
      })
    );
  }

  try {
    const actor = await getCurrentAuthorizationActor();
    const analytics = await getDashboardAnalytics(actor, filters);
    return jsonOk(analytics, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    if (error instanceof DashboardAnalyticsUnavailableError) {
      return jsonError(
        'Analytics are busy; operational dashboard data remains available.',
        503,
        undefined,
        { 'Retry-After': '5', 'Cache-Control': 'private, no-store' }
      );
    }
    logger.error('dashboard.analytics.route_failed', { error });
    return jsonError('Analytics temporarily unavailable', 503);
  }
}
