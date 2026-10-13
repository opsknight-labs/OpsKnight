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
        status: 404,
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

    if (validated.assigneeId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: validated.assigneeId },
        select: { id: true, name: true, status: true },
      });
      if (!targetUser || targetUser.status !== 'ACTIVE') {
        throw new AppError({
          code: 'USER_NOT_FOUND',
          status: 400,
          userMessage: `Assignee user with id '${validated.assigneeId}' is invalid or not active.`,
        });
      }
    }

    if (validated.teamId) {
      const targetTeam = await prisma.team.findUnique({
        where: { id: validated.teamId },
        select: { id: true },
      });
      if (!targetTeam) {
        throw new AppError({
          code: 'TEAM_NOT_FOUND',
          status: 400,
          userMessage: `Target team with id '${validated.teamId}' not found.`,
        });
      }
    }

    const updated = await prisma.$transaction(async tx => {
      const res = await tx.incident.update({
        where: { id },
        data: {
          assigneeId: validated.assigneeId !== undefined ? validated.assigneeId : undefined,
          teamId: validated.teamId !== undefined ? validated.teamId : undefined,
        },
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

      await tx.incidentEvent.create({
        data: {
          incidentId: id,
          type: 'REASSIGNED',
          message: validated.assigneeId ? `Assigned to user ${validated.assigneeId}` : 'Incident unassigned',
          actorId: actor.id,
        },
      });

      return res;
    });

    await logV2Audit({
      action: 'incident.assigned',
      entityType: 'INCIDENT',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: {
        assigneeId: validated.assigneeId ?? null,
        teamId: validated.teamId ?? null,
      },
    });

    return apiV2Success(updated, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
