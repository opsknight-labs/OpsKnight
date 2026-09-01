import { NextRequest } from 'next/server';
import { calculateSLAMetrics } from '@/lib/sla-server';
import { serializeSlaMetrics } from '@/lib/sla';
import { assertCanReadServiceMetrics } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Centralized Metrics API for Executive Dashboards
 *
 * Provides unified access to all SLA and operational metrics from sla-server.ts
 * Supports filtering by time range, team, service, and other dimensions.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const windowDays = Number(searchParams.get('window') || 7);
    const teamId = searchParams.get('teamId') || undefined;
    const serviceId = searchParams.get('serviceId') || undefined;
    const assigneeId = searchParams.get('assigneeId') || undefined;
    const urgency = searchParams.get('urgency') as 'HIGH' | 'MEDIUM' | 'LOW' | undefined;
    const status = searchParams.get('status') as
      | 'ACTIVE'
      | 'OPEN'
      | 'ACKNOWLEDGED'
      | 'SNOOZED'
      | 'SUPPRESSED'
      | 'RESOLVED'
      | undefined;
    const includeParam = searchParams.get('include') ?? '';
    const includeTokens = new Set(
      includeParam
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean)
    );
    const includeDescription = includeTokens.has('description');

    let user;
    try {
      user = await assertCanReadServiceMetrics({ serviceId, teamId });
    } catch (err) {
      return jsonError(
        new AppError({
          code: 'AUTHORIZATION_DENIED',
          details: { cause: err instanceof Error ? err.name : 'unknown' },
          cause: err,
        })
      );
    }

    const effectiveIncludeDescription =
      includeDescription && hasCapability(user.role, CAPABILITIES.INCIDENT_SENSITIVE_READ);

    const metrics = await calculateSLAMetrics({
      windowDays,
      teamId,
      serviceId,
      assigneeId,
      urgency,
      status,
      includeDescription: effectiveIncludeDescription,
    });

    const serialized = serializeSlaMetrics(metrics);

    const meta = {
      dataState: 'available',
      calculatedAt: new Date().toISOString(),
      source: (metrics as { dataSource?: string }).dataSource || 'live',
      scope: {
        backlog: 'current',
        analysis: 'selected_period',
      },
    };
    const filters = {
      windowDays,
      teamId,
      serviceId,
      assigneeId,
      urgency,
      status,
    };

    return jsonOk(serialized, 200, undefined, { meta, filters });
  } catch (error) {
    logger.error('api.reports.metrics.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}
