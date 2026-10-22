import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { apiV2Error, apiV2Success, authenticateV2Request, enforceV2Authorization, enforceV2RateLimit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { resolveEscalationTargetDetailed } from '@/lib/escalation/target-resolution';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';

/** Current, bounded service context. Every count uses the caller's read visibility. */
export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'SEARCH_EXPORT');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.NOTIFICATION_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.ESCALATION_POLICY_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SCHEDULE_READ);
    const { id } = await params;
    if (!id || id.length > 100) throw new AppError({ code: 'VALIDATION_FAILED' });
    const service = await prisma.service.findFirst({
      where: { AND: [{ id }, serviceReadWhere(actor)] },
      select: {
        id: true, name: true, status: true, escalationPolicyId: true,
        policy: { select: { steps: { orderBy: { stepOrder: 'asc' }, take: 1,
          select: { targetType: true, targetUserId: true, targetTeamId: true,
            targetScheduleId: true, notifyOnlyTeamLead: true,
            conditions: { select: { id: true }, take: 1 },
          },
        } } },
      },
    });
    if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const visibleIncident = { AND: [{ serviceId: id }, incidentReadWhere(actor)] };
    const [activeIncidentCount, recentIncidents, recentAlertCount, failedNotificationCount, objectives] = await Promise.all([
      prisma.incident.count({ where: { AND: [visibleIncident, { status: { not: 'RESOLVED' } }] } }),
      prisma.incident.findMany({
        where: visibleIncident, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 6,
        select: { id: true, title: true, status: true, createdAt: true },
      }),
      prisma.alert.count({ where: {
        serviceId: id, createdAt: { gte: since }, incident: { is: incidentReadWhere(actor) },
      } }),
      prisma.notification.count({ where: {
        incident: { is: visibleIncident }, status: 'FAILED', createdAt: { gte: since },
      } }),
      prisma.serviceObjective.findMany({
        where: { serviceId: id, activeTo: null }, orderBy: { id: 'asc' }, take: 11,
        select: {
          id: true, name: true, metricType: true, target: true,
          snapshots: { orderBy: { periodEnd: 'desc' }, take: 1,
            select: { periodEnd: true, value: true, breached: true, dataState: true },
          },
        },
      }),
    ]);
    const firstStep = service.policy?.steps[0];
    let onCallCoverage: { state: string; eligibleResponderCount: number | null };
    if (!firstStep) {
      onCallCoverage = { state: 'NO_FIRST_STEP', eligibleResponderCount: null };
    } else if (firstStep.conditions.length > 0) {
      onCallCoverage = { state: 'CONDITIONAL', eligibleResponderCount: null };
    } else {
      const targetId = firstStep.targetType === 'USER' ? firstStep.targetUserId
        : firstStep.targetType === 'TEAM' ? firstStep.targetTeamId : firstStep.targetScheduleId;
      if (!targetId) {
        onCallCoverage = { state: 'INVALID_TARGET', eligibleResponderCount: null };
      } else {
        const resolution = await resolveEscalationTargetDetailed({
          targetType: firstStep.targetType, targetId, at: now,
          notifyOnlyTeamLead: firstStep.notifyOnlyTeamLead,
        });
        onCallCoverage = {
          state: resolution.outcome,
          eligibleResponderCount: resolution.outcome === 'RESOLVED' ? resolution.userIds.length : 0,
        };
      }
    }
    return apiV2Success({
      service: { id: service.id, name: service.name, status: service.status,
        escalationPolicyId: service.escalationPolicyId },
      observedAt: now, activeIncidentCount, recentIncidents: recentIncidents.slice(0, 5),
      last24Hours: { linkedAlertCount: recentAlertCount, failedNotificationCount },
      onCallCoverage: { ...onCallCoverage, basis: 'CURRENT_FIRST_UNCONDITIONAL_STEP' },
      objectives: objectives.slice(0, 10).map(objective => ({
        id: objective.id, name: objective.name, metricType: objective.metricType,
        target: objective.target, latestSnapshot: objective.snapshots[0] ?? null,
      })),
      truncated: { objectives: objectives.length > 10, recentIncidents: recentIncidents.length > 5 },
    }, { headers: { ...rlHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
