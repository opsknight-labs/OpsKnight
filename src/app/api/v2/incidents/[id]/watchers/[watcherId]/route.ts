import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { deleteIncidentWatcher } from '@/lib/incidents/watchers';
import { AppError } from '@/lib/errors';

const paramsSchema = z
  .object({ id: z.string().trim().min(1).max(100), watcherId: z.string().trim().min(1).max(100) })
  .strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  paramsSchema,
  querySchema: z.object({}).strict(),
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
  handler: async ({ params }) => {
    const watcher = await prisma.incidentWatcher.findFirst({
      where: { id: params.watcherId, incidentId: params.id },
      select: { id: true, incidentId: true, userId: true, role: true, createdAt: true },
    });
    if (!watcher) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return { data: watcher, headers: { 'Cache-Control': 'no-store' } };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, actor, apiKey, tx }) => {
    const incident = await tx!.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const result = await deleteIncidentWatcher(params.id, params.watcherId, actor, tx);
    await logV2Audit({
      action: 'incident.watcher.removed',
      entityType: 'INCIDENT',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { watcherId: params.watcherId },
      tx,
    });
    return { data: result };
  },
});
