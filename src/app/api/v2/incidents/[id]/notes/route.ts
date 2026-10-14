import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Created,
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  idempotencyResponseHeaders,
  logV2Audit,
  runV2IdempotentMutation,
  IncidentNoteV2Schema,
} from '@/lib/api-v2';
import { addIncidentNoteDomainCommand } from '@/lib/incidents/notes';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);

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

    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ, {
      type: 'incident',
      assigneeId: incident.assigneeId,
      watcherIds: incident.watchers.map(w => w.userId),
      visibility: incident.visibility,
      serviceTeamId: incident.service.teamId,
      assignedTeamId: incident.teamId,
    });

    const notes = await prisma.incidentNote.findMany({
      where: { incidentId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        content: true,
        userId: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return apiV2Success(notes, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
});

export const POST = withV2Observability(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_NOTE);

    const { id } = await params;
    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = IncidentNoteV2Schema.parse(body);

    const execution = await runV2IdempotentMutation(
      req,
      apiKey.id,
      `incident:note:${id}`,
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

        enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_NOTE, {
          type: 'incident',
          assigneeId: incident.assigneeId,
          watcherIds: incident.watchers.map((w: { userId: string }) => w.userId),
          visibility: incident.visibility,
          serviceTeamId: incident.service.teamId,
          assignedTeamId: incident.teamId,
        });

        const note = await addIncidentNoteDomainCommand(
          {
            incidentId: id,
            content: validated.content,
            actor: { id: actor.id, name: apiKey.name },
          },
          tx
        );

        await logV2Audit({
          action: 'incident.note_added',
          entityType: 'INCIDENT',
          entityId: id,
          actorId: actor.id,
          apiKeyId: apiKey.id,
          details: { noteId: note.id },
          tx,
        });

        return note;
      }
    );

    const note = execution.value;

    return apiV2Created(note, {
      headers: {
        ...rlHeaders,
        ...idempotencyResponseHeaders(execution.replayed),
      },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
