import { NextRequest, NextResponse } from 'next/server';
import { calculateSLAMetrics } from '@/lib/sla-server';
import { serializeSlaMetrics } from '@/lib/sla';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertCanReadServiceMetrics } from '@/lib/rbac';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Centralized Metrics API for Executive Dashboards
 *
 * Provides unified access to all SLA and operational metrics from sla-server.ts
 * Supports filtering by time range, team, service, and other dimensions.
 *
 * Query Parameters:
 * - window: number of days (default: 7)
 * - teamId: filter by team
 * - serviceId: filter by service
 * - assigneeId: filter by assignee
 * - urgency: filter by urgency level
 * - status: filter by incident status
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Parse filter parameters
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
    // Description is opt-in (PII). The `?include=description` shape
    // lets us extend with more opt-in fields later (e.g.
    // `?include=description,internal-notes`) without churning the
    // route signature.
    const includeParam = searchParams.get('include') ?? '';
    const includeTokens = new Set(
      includeParam
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean)
    );
    const includeDescription = includeTokens.has('description');

    // Enforce that the caller is allowed to read metrics for the requested
    // scope. ADMIN/RESPONDER pass through; regular USERs must have a team
    // membership covering every serviceId/teamId in the filter.
    let user;
    try {
      user = await assertCanReadServiceMetrics({ serviceId, teamId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unauthorized';
      return NextResponse.json({ error: message }, { status: 403 });
    }

    // `?include=description` is opt-in PII. Only honored for ADMIN /
    // RESPONDER — regular USERs get description=null even when they
    // pass the flag, since their team scope might still expose them to
    // descriptions they shouldn't read.
    const effectiveIncludeDescription =
      includeDescription && (user.role === 'ADMIN' || user.role === 'RESPONDER');

    // Calculate metrics using the centralized SLA server
    const metrics = await calculateSLAMetrics({
      windowDays,
      teamId,
      serviceId,
      assigneeId,
      urgency,
      status,
      includeDescription: effectiveIncludeDescription,
    });

    // Serialize dates for JSON response
    const serialized = serializeSlaMetrics(metrics);

    return NextResponse.json({
      success: true,
      data: serialized,
      meta: {
        dataState: 'available',
        calculatedAt: new Date().toISOString(),
        source: (metrics as { dataSource?: string }).dataSource || 'live',
        scope: {
          backlog: 'current',
          analysis: 'selected_period',
        },
      },
      filters: {
        windowDays,
        teamId,
        serviceId,
        assigneeId,
        urgency,
        status,
      },
    });
  } catch (error) {
    logger.error('api.reports.metrics.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
