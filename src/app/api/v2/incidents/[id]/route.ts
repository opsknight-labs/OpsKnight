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
import { incidentReadWhere } from '@/lib/authorization-filters';
import { applyRestIncidentPatch } from '@/lib/incidents/rest-patch';
import { toIncidentApiDto } from '@/lib/incidents/api-dto';
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
    const accessWhere = incidentReadWhere(actor);

    const incident = await prisma.incident.findFirst({
      where: {
        AND: [
          { id },
          accessWhere,
        ],
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        urgency: true,
        serviceId: true,
        service: { select: { id: true, name: true } },
        assigneeId: true,
        assignee: { select: { id: true, name: true, email: true } },
        teamId: true,
        team: { select: { id: true, name: true } },
        createdAt: true,
        updatedAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        snoozedUntil: true,
        slaPausedMs: true,
        slaAckElapsedMs: true,
        slaResolveElapsedMs: true,
      },
    });

    if (!incident) {
      throw new AppError({
        code: 'INCIDENT_NOT_FOUND',
        userMessage: `Incident with id '${id}' was not found.`,
      });
    }

    return apiV2Success(toIncidentApiDto(incident), { headers: rlHeaders });
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
    const accessWhere = incidentReadWhere(actor);

    const existing = await prisma.incident.findFirst({
      where: {
        AND: [
          { id },
          accessWhere,
        ],
      },
      select: {
        id: true,
        serviceId: true,
        assigneeId: true,
        visibility: true,
        teamId: true,
      },
    });

    if (!existing) {
      throw new AppError({
        code: 'INCIDENT_NOT_FOUND',
        userMessage: `Incident with id '${id}' was not found.`,
      });
    }

    const body = await req.json().catch(() => {
      throw new AppError({
        code: 'INVALID_JSON',
        userMessage: 'Invalid JSON request body.',
      });
    });

    const validated = IncidentUpdateV2Schema.parse(body);
    const idempotencyKey = req.headers.get('idempotency-key')?.trim();

    const hasAssigneeUpdate = validated.assigneeId !== undefined;
    const patchResult = await applyRestIncidentPatch({
      incidentId: id,
      title: validated.title,
      description: validated.description,
      priority: validated.priority,
      status: validated.status,
      urgency: validated.urgency,
      assigneeId: hasAssigneeUpdate ? (validated.assigneeId ?? null) : undefined,
      hasAssigneeUpdate,
      actor: { id: actor.id, name: apiKey.name },
      idempotency: idempotencyKey ? { key: idempotencyKey, principalId: apiKey.id } : undefined,
    });

    const finalIncident = patchResult.incident;

    if (!patchResult.idempotencyReplayed) {
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
      ...idempotencyResponseHeaders(patchResult.idempotencyReplayed),
    };

    return apiV2Success(toIncidentApiDto(finalIncident), { headers });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
