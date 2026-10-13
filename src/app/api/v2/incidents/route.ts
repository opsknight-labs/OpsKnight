import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Created,
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  buildCursorWhere,
  enforceV2Authorization,
  enforceV2RateLimit,
  formatCursorPagination,
  idempotencyResponseHeaders,
  logV2Audit,
  parsePaginationParams,
  IncidentCreateV2Schema,
  IncidentListQuerySchema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { executeIdempotentIncidentCreation } from '@/lib/incidents/idempotent-commands';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);

    const { searchParams } = new URL(req.url);
    const query = IncidentListQuerySchema.parse(Object.fromEntries(searchParams.entries()));
    const { limit, cursor } = parsePaginationParams(searchParams);

    const accessWhere = incidentReadWhere(actor);
    const filters: Prisma.IncidentWhereInput[] = [accessWhere];

    if (query.status) filters.push({ status: query.status });
    if (query.priority) filters.push({ priority: query.priority });
    if (query.urgency) filters.push({ urgency: query.urgency });
    if (query.serviceId) filters.push({ serviceId: query.serviceId });
    if (query.assigneeId) filters.push({ assigneeId: query.assigneeId });
    if (query.teamId) filters.push({ teamId: query.teamId });
    if (query.search) {
      filters.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.IncidentWhereInput);
    }

    const where: Prisma.IncidentWhereInput = { AND: filters };

    const incidents = await prisma.incident.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        urgency: true,
        serviceId: true,
        assigneeId: true,
        teamId: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        service: {
          select: { id: true, name: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    const result = formatCursorPagination(incidents, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_CREATE);

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = IncidentCreateV2Schema.parse(body);

    const service = await prisma.service.findUnique({
      where: { id: validated.serviceId },
      select: { id: true, teamId: true },
    });

    if (!service) {
      throw new AppError({
        code: 'SERVICE_NOT_FOUND',
        userMessage: `Service with id '${validated.serviceId}' not found.`,
      });
    }

    // Verify service-level scope
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_CREATE, {
      type: 'service',
      teamId: service.teamId,
    });

    const idempotencyKey = req.headers.get('idempotency-key')?.trim();
    const execution = await executeIdempotentIncidentCreation(
      {
        title: validated.title,
        description: validated.description ?? null,
        serviceId: validated.serviceId,
        urgency: validated.urgency,
        priority: validated.priority ?? null,
        dedupKey: validated.dedupKey ?? null,
        assigneeId: validated.assigneeId ?? null,
        teamId: validated.teamId ?? service.teamId ?? null,
        customFields: validated.customFields,
        source: 'REST_API',
        actor: { id: actor.id },
      },
      idempotencyKey ? { key: idempotencyKey, principalId: apiKey.id } : undefined
    );

    const createdId = execution.value.id;
    const incident = await prisma.incident.findUnique({
      where: { id: createdId },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        urgency: true,
        serviceId: true,
        assigneeId: true,
        teamId: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        service: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    });

    if (!incident) {
      throw new AppError({
        code: 'INTERNAL_ERROR',
        userMessage: 'Failed to retrieve created incident.',
      });
    }

    if (!execution.replayed) {
      await logV2Audit({
        action: 'incident.created',
        entityType: 'INCIDENT',
        entityId: incident.id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: {
          title: incident.title,
          serviceId: incident.serviceId,
          urgency: incident.urgency,
          priority: incident.priority,
        },
      });
    }

    const headers = {
      ...rlHeaders,
      ...idempotencyResponseHeaders(execution.replayed),
    };

    return apiV2Created(incident, { headers });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
