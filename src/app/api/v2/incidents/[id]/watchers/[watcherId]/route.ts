import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { deleteIncidentWatcher } from '@/lib/incidents/watchers';
import { AppError } from '@/lib/errors';

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  paramsSchema: z
    .object({ id: z.string().trim().min(1).max(100), watcherId: z.string().trim().min(1).max(100) })
    .strict(),
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
