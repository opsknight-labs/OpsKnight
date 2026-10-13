import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  IncidentAssignV2Schema,
} from '@/lib/api-v2';
import { assignIncidentDomainCommand } from '@/lib/incidents/assignment';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_MANAGE);

    const { id } = await params;
    const incident = await prisma.incident.findUnique({
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
      watcherIds: incident.watchers.map(w => w.userId),
      visibility: incident.visibility,
      serviceTeamId: incident.service.teamId,
      assignedTeamId: incident.teamId,
    });

    const body = await req.json().catch(() => ({}));
    const validated = IncidentAssignV2Schema.parse(body);

    const result = await assignIncidentDomainCommand({
      incidentId: id,
      assigneeId: validated.assigneeId,
      teamId: validated.teamId,
      actor: { id: actor.id, name: apiKey.name },
    });

    const updated = await prisma.incident.findUnique({
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
    });

    return apiV2Success(updated, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
