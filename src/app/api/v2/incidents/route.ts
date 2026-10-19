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
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(req: NextRequest) {
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
});

export const POST = withV2Observability(async function POST(req: NextRequest) {
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

    // Mutually exclusive assignment: an individual assignee must not implicitly inherit the service team
    if (validated.assigneeId && validated.teamId) {
      throw new AppError({
        code: 'INCIDENT_INVALID_ARGUMENT',
        userMessage: 'Assign an incident to either a user or a team, not both.',
        fields: [
          {
            field: 'assigneeId',
            code: 'invalid',
            message: 'Assign an incident to either a user or a team, not both.',
          },
        ],
      });
    }

    const assigneeId = validated.assigneeId ?? null;
    const teamId = assigneeId ? null : (validated.teamId ?? service.teamId ?? null);

    const idempotencyKey = req.headers.get('idempotency-key')?.trim();
    const execution = await executeIdempotentIncidentCreation(
      {
        title: validated.title,
        description: validated.description ?? null,
        serviceId: validated.serviceId,
        urgency: validated.urgency,
        priority: validated.priority ?? null,
        dedupKey: validated.dedupKey ?? null,
        assigneeId,
        teamId,
        customFields: validated.customFields,
        source: 'REST_API',
        actor: { id: actor.id },
      },
      idempotencyKey ? { key: idempotencyKey, principalId: apiKey.id } : undefined,
      (tx, created) =>
        // A deduplicated alert merges into an existing incident; only a real creation is audited as one.
        created.outcome === 'CREATED'
          ? logV2Audit({
              action: 'incident.created',
              entityType: 'INCIDENT',
              entityId: created.id,
              actorId: actor.id,
              apiKeyId: apiKey.id,
              details: {
                title: validated.title,
                serviceId: validated.serviceId,
                urgency: validated.urgency,
                priority: validated.priority ?? null,
              },
              tx,
            })
          : Promise.resolve()
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

    const headers = {
      ...rlHeaders,
      ...idempotencyResponseHeaders(execution.replayed),
    };

    return apiV2Created(incident, { headers });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
