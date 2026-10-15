import { NextRequest } from 'next/server';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  idempotencyResponseHeaders,
  logV2Audit,
  runV2IdempotentMutation,
  IncidentAssignV2Schema,
} from '@/lib/api-v2';
import { assignIncidentDomainCommand } from '@/lib/incidents/assignment';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';
import { withV2Observability } from '@/lib/api-v2/observability';

export const POST = withV2Observability(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_MANAGE);

    const { id } = await params;
    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });
    const validated = IncidentAssignV2Schema.parse(body);

    const execution = await runV2IdempotentMutation(
      req,
      apiKey.id,
      `incident:assign:${id}`,
      validated,
      async (tx: Prisma.TransactionClient) => {
        const incident = await tx.incident.findUnique({
          where: { id },
          include: {
            service: { select: { id: true, name: true, teamId: true } },
            watchers: { select: { userId: true } },
          },
        });

        if (!incident) {
          throw new AppError({
            code: 'INCIDENT_NOT_FOUND',
            userMessage: `Incident with id '${id}' was not found.`,
          });
        }

        enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_MANAGE, {
          type: 'incident',
          assigneeId: incident.assigneeId,
          watcherIds: incident.watchers.map((w: { userId: string }) => w.userId),
          visibility: incident.visibility,
          serviceTeamId: incident.service.teamId,
          assignedTeamId: incident.teamId,
        });

        const result = await assignIncidentDomainCommand(
          {
            incidentId: id,
            assigneeId: validated.assigneeId,
            teamId: validated.teamId,
            actor: { id: actor.id, name: apiKey.name },
          },
          tx
        );

        const updated = await tx.incident.findUnique({
          where: { id },
          select: {
            id: true,
            title: true,
            status: true,
            assigneeId: true,
            teamId: true,
            assignee: { select: { id: true, name: true, email: true } },
            team: { select: { id: true, name: true } },
            updatedAt: true,
          },
        });

        await logV2Audit({
          action: 'incident.assigned',
          entityType: 'INCIDENT',
          entityId: id,
          actorId: actor.id,
          apiKeyId: apiKey.id,
          details: {
            assigneeId: result.assigneeId,
            teamId: result.teamId,
          },
          tx,
        });

        return { updated, result };
      }
    );

    const { updated } = execution.value;

    return apiV2Success(updated, {
      headers: {
        ...rlHeaders,
        ...idempotencyResponseHeaders(execution.replayed),
      },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
