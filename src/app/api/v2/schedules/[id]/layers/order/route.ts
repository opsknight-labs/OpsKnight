import { z } from 'zod';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { reorderScheduleLayers } from '@/lib/schedules/layer-commands';
import { AppError } from '@/lib/errors';

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z.object({
    orderedIds: z.array(z.string().trim().min(1).max(100)).max(100),
  }).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, tx }) => {
    const exists = await tx!.onCallSchedule.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) throw new AppError({ code: 'SCHEDULE_NOT_FOUND' });
  },
  handler: async ({ params, body, req, actor, apiKey, tx }) => {
    const result = await reorderScheduleLayers(
      tx!, params.id, body.orderedIds, requireRevisionIfMatch(req)
    );
    await logV2Audit({
      action: 'schedule.layer.precedence_updated',
      entityType: 'SCHEDULE', entityId: params.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { orderedIds: result.orderedIds }, tx,
    });
    return { data: result, headers: { ...etagHeaders(result.revision), 'Cache-Control': 'no-store' } };
  },
});
