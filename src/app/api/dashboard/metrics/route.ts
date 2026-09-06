import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';
import { getDashboardRealtimeMetrics } from '@/lib/dashboard/dashboard-realtime-metrics';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['service', 'assignee', 'urgency', 'search']);
class InvalidDashboardMetricFilterError extends Error {}

function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) throw new InvalidDashboardMetricFilterError(`Duplicate ${name} filter`);
  return values[0] || undefined;
}

function identifier(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  if (value.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new InvalidDashboardMetricFilterError(`Invalid ${name}`);
  }
  return value;
}

export async function GET(request: Request) {
  const session = await getServerSession(await getAuthOptions());
  if (!session) return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));
  try {
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) {
      if (!ALLOWED.has(key)) {
        throw new InvalidDashboardMetricFilterError(`Unsupported filter: ${key}`);
      }
    }
    const urgency = single(params, 'urgency');
    if (urgency && !['HIGH', 'MEDIUM', 'LOW'].includes(urgency)) {
      throw new InvalidDashboardMetricFilterError('Invalid urgency');
    }
    const search = single(params, 'search');
    if (search && search.length > 200) {
      throw new InvalidDashboardMetricFilterError('Invalid search');
    }
    const rawAssignee = single(params, 'assignee');
    const assignee = rawAssignee === 'unassigned' ? '' : identifier(rawAssignee, 'assignee');
    const actor = await getCurrentAuthorizationActor();
    const generation = await getRealtimeChangeGeneration().catch(() => null);
    const metrics = await getDashboardRealtimeMetrics(
      actor,
      {
        service: identifier(single(params, 'service'), 'service'),
        assignee,
        urgency,
        search,
      },
      generation
    );
    return jsonOk(metrics, 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  } catch (error) {
    if (error instanceof InvalidDashboardMetricFilterError) {
      return jsonError(
        new AppError({ code: 'INCIDENT_INVALID_ARGUMENT', userMessage: error.message })
      );
    }
    logger.error('dashboard.realtime_metrics.failed', { error });
    return jsonError('Dashboard metrics temporarily unavailable', 503);
  }
}
