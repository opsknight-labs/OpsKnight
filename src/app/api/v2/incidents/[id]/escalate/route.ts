import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { idempotencyResponseHeaders } from '@/lib/api-v2/idempotency';
import { internalV2MutationGuard } from '@/lib/api-v2/internal-context';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requestIncidentEscalation } from '@/lib/escalation/authorization';
import { AppError } from '@/lib/errors';

/**
 * Page the next escalation tier now, through the same entry point as Slack, Teams and the web UI.
 * The escalation engine sends notifications, so it never runs inside a database transaction; the
 * Idempotency-Key is honoured by the engine's own manual-escalation receipt instead.
 */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_ESCALATE,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  resourceExtractor: async ({ params }) => {
    const incident = await prisma.incident.findUnique({
      where: { id: params.id },
      select: {
        assigneeId: true,
        teamId: true,
        visibility: true,
        service: { select: { teamId: true } },
        watchers: { select: { userId: true } },
      },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    return {
      type: 'incident' as const,
      assigneeId: incident.assigneeId,
      assignedTeamId: incident.teamId,
      serviceTeamId: incident.service.teamId,
      visibility: incident.visibility,
      watcherIds: incident.watchers.map(watcher => watcher.userId),
    };
  },
  handler: async ({ req, params, actor, apiKey }) => {
    const key = req.headers.get('idempotency-key')?.trim();
    if (key && key.length > 200) throw new AppError({ code: 'IDEMPOTENCY_KEY_INVALID' });
    // An in-process MCP call re-checks live authority on the locked incident before paging anyone.
    const guard = internalV2MutationGuard();
    if (guard) await prisma.$transaction(tx => guard(tx, 'mutation'));
    // A key reused for another incident or actor raises IDEMPOTENCY_KEY_CONFLICT (409).
    const outcome = await requestIncidentEscalation({
      incidentId: params.id,
      actor: { userId: actor.id },
      source: 'REST_API',
      idempotency: key ? { key, principalId: apiKey.id } : undefined,
    });
    if (!outcome.requested && outcome.reason === 'INCIDENT_NOT_FOUND')
      throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const incident = await prisma.incident.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        currentEscalationStep: true,
        escalationStatus: true,
        nextEscalationAt: true,
      },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const execution = outcome.requested ? outcome.execution : null;
    return {
      headers: idempotencyResponseHeaders(outcome.requested && outcome.replayed === true),
      data: {
        requested: outcome.requested,
        // Only an OPEN incident escalates; acknowledged, snoozed or resolved ones are left alone.
        reason: outcome.requested ? null : outcome.reason,
        outcome: execution?.outcome ?? null,
        escalated: execution?.escalated ?? false,
        // Who this request paged: the impact a responder needs to confirm.
        paged: execution?.escalated
          ? {
              stepIndex: execution.stepIndex ?? null,
              targetType: execution.targetType ?? null,
              targetName: execution.targetName ?? null,
              targetCount: execution.targetCount ?? null,
            }
          : null,
        incident: {
          id: incident.id,
          status: incident.status,
          escalation: {
            step: incident.currentEscalationStep,
            status: incident.escalationStatus,
            nextAt: incident.nextEscalationAt,
          },
        },
      },
    };
  },
});
