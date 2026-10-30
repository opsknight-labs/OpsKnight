import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { escalationConditionsMatch } from '@/lib/escalation/conditions';
import { resolveEscalationTargetDetailed } from '@/lib/escalation/target-resolution';
import { resolveSupportHours } from '@/lib/incidents/support-hours';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';

const previewSchema = z
  .object({
    incidentId: z.string().trim().min(1).max(100),
    at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
const MAX_STEPS = 100;
const MAX_LOOKAHEAD_MS = 30 * 24 * 60 * 60 * 1000;

/** Read-only estimate; actual escalation rechecks state and may follow pinned policy versions. */
export const POST = withV2Observability(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'SEARCH_EXPORT');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.ESCALATION_POLICY_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.USER_READ);
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SCHEDULE_READ);
    const { id } = await params;
    if (!id || id.length > 100) throw new AppError({ code: 'VALIDATION_FAILED' });
    const body = previewSchema.parse(
      await req.json().catch(() => {
        throw new AppError({ code: 'INVALID_JSON' });
      })
    );
    const at = body.at ? new Date(body.at) : new Date();
    if (Math.abs(at.getTime() - Date.now()) > MAX_LOOKAHEAD_MS) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Preview time must be within 30 days of now.',
      });
    }
    const [policy, incident] = await Promise.all([
      prisma.escalationPolicy.findUnique({
        where: { id },
        select: {
          id: true,
          revision: true,
          archivedAt: true,
          steps: {
            orderBy: { stepOrder: 'asc' },
            take: MAX_STEPS + 1,
            select: {
              id: true,
              stepOrder: true,
              delayMinutes: true,
              targetType: true,
              targetUserId: true,
              targetTeamId: true,
              targetScheduleId: true,
              notifyOnlyTeamLead: true,
              conditions: { select: { field: true, operator: true, values: true } },
            },
          },
        },
      }),
      prisma.incident.findFirst({
        where: { AND: [{ id: body.incidentId }, incidentReadWhere(actor)] },
        select: { id: true, serviceId: true, priority: true, urgency: true },
      }),
    ]);
    if (!policy || policy.archivedAt) throw new AppError({ code: 'ESCALATION_POLICY_NOT_FOUND' });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const supportHours = await prisma.$transaction(tx =>
      resolveSupportHours(tx, { serviceId: incident.serviceId, at })
    );
    const steps: Array<{
      stepId: string;
      stepOrder: number;
      delayMinutes: number;
      targetType: string;
      applicable: boolean;
      outcome: string;
      recipientUserIds: string[];
    }> = [];
    const visibleSteps = policy.steps.slice(0, MAX_STEPS);
    // Target resolution can inspect schedules and teams; cap concurrent database work.
    for (let offset = 0; offset < visibleSteps.length; offset += 10) {
      const batch = await Promise.all(
        visibleSteps.slice(offset, offset + 10).map(async step => {
          const applicable = escalationConditionsMatch(step.conditions, {
            priority: incident.priority as 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | null,
            urgency: incident.urgency,
            supportHoursState: supportHours.state,
          });
          const targetId =
            step.targetType === 'USER'
              ? step.targetUserId
              : step.targetType === 'TEAM'
                ? step.targetTeamId
                : step.targetScheduleId;
          const resolution =
            applicable && targetId
              ? await resolveEscalationTargetDetailed({
                  targetType: step.targetType,
                  targetId,
                  at,
                  notifyOnlyTeamLead: step.notifyOnlyTeamLead,
                })
              : null;
          return {
            stepId: step.id,
            stepOrder: step.stepOrder,
            delayMinutes: step.delayMinutes,
            targetType: step.targetType,
            applicable,
            outcome: !applicable
              ? 'CONDITIONS_NOT_MET'
              : !targetId
                ? 'INVALID_TARGET'
                : (resolution?.outcome ?? 'INVALID_TARGET'),
            recipientUserIds: resolution?.outcome === 'RESOLVED' ? resolution.userIds : [],
          };
        })
      );
      steps.push(...batch);
    }
    return apiV2Success(
      {
        policyId: policy.id,
        policyRevision: policy.revision,
        incidentId: incident.id,
        evaluatedAt: at,
        supportHoursState: supportHours.state,
        steps,
        truncated: policy.steps.length > MAX_STEPS,
        timingAssumption:
          'Each delayMinutes value applies when its step is reached; actual timing depends on prior delivery and incident state.',
        advisory: true,
      },
      { headers: { ...rlHeaders, 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return apiV2Error(error, req);
  }
});
