import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { apiV2Error, apiV2Success, authenticateV2Request, enforceV2Authorization, enforceV2RateLimit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere, runbookExecutionReadWhere } from '@/lib/authorization-filters';
import { incidentCorrelationHash } from '@/lib/api-v2/incident-diagnostics';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';

const SECTION_LIMIT = 50;

/** Bounded, safe projections for responder investigation. Sections can advance independently. */
export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'SEARCH_EXPORT');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.NOTIFICATION_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.RUNBOOK_READ);
    const { id } = await params;
    if (!id || id.length > 100) throw new AppError({ code: 'VALIDATION_FAILED' });

    const incident = await prisma.incident.findFirst({
      where: { AND: [{ id }, incidentReadWhere(actor)] },
      select: {
        id: true, title: true, status: true, serviceId: true, createdAt: true,
        acknowledgedAt: true, resolvedAt: true, resolutionKind: true,
        automationDecision: { select: {
          mode: true, routeType: true, escalationPolicyId: true,
          matchedRouteRuleId: true, evaluationAt: true,
        } },
      },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });

    const [alerts, events, notifications, executions] = await Promise.all([
      prisma.alert.findMany({
        where: { incidentId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SECTION_LIMIT + 1,
        select: { id: true, status: true, dedupKey: true, createdAt: true },
      }),
      prisma.incidentEvent.findMany({
        where: { incidentId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SECTION_LIMIT + 1,
        select: { id: true, type: true, createdAt: true },
      }),
      prisma.notification.findMany({
        where: { incidentId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SECTION_LIMIT + 1,
        select: {
          id: true, channel: true, status: true, attempts: true,
          createdAt: true, sentAt: true, deliveredAt: true, failedAt: true,
        },
      }),
      prisma.runbookExecution.findMany({
        where: { AND: [{ incidentId: id }, runbookExecutionReadWhere(actor)] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: SECTION_LIMIT + 1,
        select: {
          id: true, runbookId: true, status: true, createdAt: true, startedAt: true,
          completedAt: true, recoveryOutcome: true,
          runbook: { select: { name: true } },
        },
      }),
    ]);
    return apiV2Success({
      incident,
      alerts: alerts.slice(0, SECTION_LIMIT).map(alert => ({
        id: alert.id,
        status: alert.status,
        createdAt: alert.createdAt,
        correlationHash: alert.dedupKey
          ? incidentCorrelationHash(alert.dedupKey)
          : null,
      })),
      events: events.slice(0, SECTION_LIMIT),
      notifications: notifications.slice(0, SECTION_LIMIT),
      executions: executions.slice(0, SECTION_LIMIT),
      truncated: {
        alerts: alerts.length > SECTION_LIMIT,
        events: events.length > SECTION_LIMIT,
        notifications: notifications.length > SECTION_LIMIT,
        executions: executions.length > SECTION_LIMIT,
      },
    }, { headers: { ...rlHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
