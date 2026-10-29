import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { removeIncidentTag } from '@/lib/incidents/tags';
import { AppError } from '@/lib/errors';

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  paramsSchema: z
    .object({ id: z.string().trim().min(1).max(100), tagId: z.string().trim().min(1).max(100) })
    .strict(),
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, actor, tx }) => {
    const incident = await tx!.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
  },
  handler: async ({ params, actor, apiKey, tx }) => {
    const incident = await tx!.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const result = await removeIncidentTag(params.id, params.tagId, undefined, tx);
    if (result.removed) {
      await logV2Audit({
        action: 'incident.tag.removed',
        entityType: 'INCIDENT',
        entityId: params.id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { tagId: params.tagId },
        tx,
      });
    }
    return { data: result };
  },
});
