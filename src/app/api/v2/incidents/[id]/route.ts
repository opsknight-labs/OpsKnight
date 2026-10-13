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
  IncidentUpdateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { applyRestIncidentPatch } from '@/lib/incidents/rest-patch';
import { AppError } from '@/lib/errors';

export async function GET(
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
        assignee: { select: { id: true, name: true, email: true } },
      },
    });

    if (!incident) {
      throw new AppError({
        code: 'INCIDENT_NOT_FOUND',
        status: 404,
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

    return apiV2Success(incident, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_MANAGE);

    const { id } = await params;
    const existing = await prisma.incident.findUnique({
      where: { id },
      include: {
        service: { select: { id: true, name: true, teamId: true } },
        watchers: { select: { userId: true } },
      },
    });

    if (!existing) {
      throw new AppError({
        code: 'INCIDENT_NOT_FOUND',
        status: 404,
        userMessage: `Incident with id '${id}' was not found.`,
      });
    }

    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_MANAGE, {
      type: 'incident',
      assigneeId: existing.assigneeId,
      watcherIds: existing.watchers.map(w => w.userId),
      visibility: existing.visibility,
      serviceTeamId: existing.service.teamId,
      assignedTeamId: existing.teamId,
    });

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', status: 400, userMessage: 'Invalid JSON request body.' });
    });

    const validated = IncidentUpdateV2Schema.parse(body);
    const idempotencyKey = req.headers.get('idempotency-key')?.trim();

    const result = await applyRestIncidentPatch({
      incidentId: id,
      input: {
        title: validated.title,
        description: validated.description,
        priority: validated.priority,
        urgency: validated.urgency,
      },
      actor: { id: actor.id },
      idempotency: idempotencyKey ? { key: idempotencyKey, principalId: apiKey.id } : undefined,
    });

    if (!result.replayed) {
      await logV2Audit({
        action: 'incident.updated',
        entityType: 'INCIDENT',
        entityId: id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: validated,
      });
    }

    const headers = {
      ...rlHeaders,
      ...idempotencyResponseHeaders(result.replayed),
    };

    return apiV2Success(result.incident, { headers });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
