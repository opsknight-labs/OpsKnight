import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  idempotencyResponseHeaders,
  logV2Audit,
  IncidentAcknowledgeV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { executeIdempotentIncidentLifecycleCommand } from '@/lib/incidents/idempotent-commands';
import { AppError } from '@/lib/errors';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE);

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

    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE, {
      type: 'incident',
      assigneeId: incident.assigneeId,
      watcherIds: incident.watchers.map(w => w.userId),
      visibility: incident.visibility,
      serviceTeamId: incident.service.teamId,
      assignedTeamId: incident.teamId,
    });

    const body = await req.json().catch(() => ({}));
    const validated = IncidentAcknowledgeV2Schema.parse(body);

    const idempotencyKey = req.headers.get('idempotency-key')?.trim();
    const execution = await executeIdempotentIncidentLifecycleCommand(
      {
        incidentId: id,
        command: 'ACKNOWLEDGE',
        source: 'REST_API',
        actor: { id: actor.id },
        eventMessage: validated.note,
      },
      idempotencyKey ? { key: idempotencyKey, principalId: apiKey.id } : undefined
    );

    const updated = await prisma.incident.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        urgency: true,
        acknowledgedAt: true,
        updatedAt: true,
      },
    });

    if (!execution.replayed) {
      await logV2Audit({
        action: 'incident.acknowledged',
        entityType: 'INCIDENT',
        entityId: id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { note: validated.note ?? null },
      });
    }

    const headers = {
      ...rlHeaders,
      ...idempotencyResponseHeaders(execution.replayed),
    };

    return apiV2Success(updated, { headers });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
