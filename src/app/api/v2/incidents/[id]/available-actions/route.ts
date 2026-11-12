import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { resolveIncidentResourceForActor } from '@/lib/access/incident-relations';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
} from '@/lib/api-v2';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationResource,
} from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';

/** Advisory snapshot. Mutation endpoints always repeat authorization and state checks. */
export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    const { id } = await params;
    if (!id || id.length > 100) throw new AppError({ code: 'VALIDATION_FAILED' });
    // Read access is decided with the full resource (assignee, team, watchers, on call), so
    // people paged for an incident can see what they may do with it.
    const incident = await prisma.incident.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        assigneeId: true,
        visibility: true,
        teamId: true,
        service: { select: { teamId: true } },
        watchers: { select: { userId: true } },
      },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const resolved = await resolveIncidentResourceForActor(actor, id);
    if (
      !resolved ||
      !authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_READ, resource: resolved }).allowed
    )
      throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const resource: AuthorizationResource = resolved ?? {
      type: 'incident',
      assigneeId: incident.assigneeId,
      watcherIds: incident.watchers.map(watcher => watcher.userId),
      visibility: incident.visibility,
      serviceTeamId: incident.service.teamId,
      assignedTeamId: incident.teamId,
    };
    const mutable = incident.status !== 'RESOLVED';
    const actions = [
      {
        operationId: 'acknowledgeIncident',
        path: `/incidents/${id}/acknowledge`,
        action: AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE,
        stateEligible: mutable,
      },
      {
        operationId: 'resolveIncident',
        path: `/incidents/${id}/resolve`,
        action: AUTHORIZATION_ACTIONS.INCIDENT_RESOLVE,
        stateEligible: mutable,
      },
      {
        operationId: 'reopenIncident',
        path: `/incidents/${id}/reopen`,
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        stateEligible: incident.status === 'RESOLVED',
      },
      {
        operationId: 'unacknowledgeIncident',
        path: `/incidents/${id}/unacknowledge`,
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        stateEligible: incident.status === 'ACKNOWLEDGED',
      },
      {
        operationId: 'assignIncident',
        path: `/incidents/${id}/assign`,
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        stateEligible: true,
      },
      {
        operationId: 'addIncidentNote',
        path: `/incidents/${id}/notes`,
        action: AUTHORIZATION_ACTIONS.INCIDENT_NOTE,
        stateEligible: true,
      },
      {
        operationId: 'snoozeIncident',
        path: `/incidents/${id}/snooze`,
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        stateEligible: mutable,
      },
      {
        operationId: 'unsnoozeIncident',
        path: `/incidents/${id}/unsnooze`,
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        stateEligible: incident.status === 'SNOOZED',
      },
      {
        operationId: 'suppressIncident',
        path: `/incidents/${id}/suppress`,
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        stateEligible: mutable,
      },
      {
        operationId: 'unsuppressIncident',
        path: `/incidents/${id}/unsuppress`,
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        stateEligible: incident.status === 'SUPPRESSED',
      },
    ] as const;
    return apiV2Success(
      {
        incidentId: id,
        incidentStatus: incident.status,
        observedAt: incident.updatedAt,
        advisory: true,
        actions: actions.map(candidate => ({
          operationId: candidate.operationId,
          method: 'POST',
          path: `/api/v2${candidate.path}`,
          allowed:
            candidate.stateEligible &&
            authorize({
              actor,
              action: candidate.action,
              resource,
            }).allowed,
          stateEligible: candidate.stateEligible,
        })),
        runbookExecution: {
          requiresRunbookSelection: true,
          previewPath: '/api/v2/runbooks/{id}/executions/preview',
          allowedToAttemptPreview: authorize({
            actor,
            action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
          }).allowed,
        },
      },
      { headers: { ...rlHeaders, 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return apiV2Error(error, req);
  }
});
