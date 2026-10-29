import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { ScheduleLayerParams, requireScheduleLayer } from '@/lib/api-v2/schedule-participants';
import { addScheduleLayerUser } from '@/lib/schedules/mutations';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
  paramsSchema: ScheduleLayerParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ userId: z.string().trim().min(1).max(100) }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    await requireScheduleLayer(tx!, params);
    const result = await addScheduleLayerUser(params.layerId, body.userId, tx);
    await logV2Audit({
      action: 'schedule.participant.added',
      entityType: 'SCHEDULE',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: result,
      tx,
    });
    return { status: 201, data: result };
  },
});
