import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { IncidentWatcherSchema, setIncidentWatcher } from '@/lib/incidents/watchers';
import { AppError } from '@/lib/errors';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: PaginationQuerySchema.strict(),
  resourceExtractor: async ({ actor, params }) => {
    const incident = await prisma.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      include: { service: { select: { teamId: true } }, watchers: { select: { userId: true } } },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    return {
      type: 'incident' as const,
      assigneeId: incident.assigneeId,
      assignedTeamId: incident.teamId,
      serviceTeamId: incident.service.teamId,
      visibility: incident.visibility,
      watcherIds: incident.watchers.map(item => item.userId),
    };
  },
  handler: async ({ params, pagination }) => {
    const watchers = await prisma.incidentWatcher.findMany({
      where: { AND: [{ incidentId: params.id }, buildCursorWhere(pagination.cursor)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      select: { id: true, incidentId: true, userId: true, role: true, createdAt: true },
    });
    return formatCursorPagination(watchers, pagination.limit);
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: IncidentWatcherSchema.omit({ incidentId: true }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const incident = await tx!.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const watcher = await setIncidentWatcher({ ...body, incidentId: params.id }, actor, tx);
    await logV2Audit({
      action: 'incident.watcher.updated',
      entityType: 'INCIDENT',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { userId: body.userId, role: body.role },
      tx,
    });
    return { data: watcher };
  },
});
