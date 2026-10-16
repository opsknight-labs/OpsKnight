import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  ScheduleParticipantParams,
  requireScheduleLayer,
} from '@/lib/api-v2/schedule-participants';
import { removeScheduleLayerUser, moveScheduleLayerUser } from '@/lib/schedules/mutations';

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
  paramsSchema: ScheduleParticipantParams,
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, actor, apiKey, tx }) => {
    await requireScheduleLayer(tx!, params);
    const result = await removeScheduleLayerUser(params.layerId, params.userId, tx);
    await logV2Audit({
      action: 'schedule.participant.removed',
      entityType: 'SCHEDULE',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: result,
      tx,
    });
    return { data: result };
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
  paramsSchema: ScheduleParticipantParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ direction: z.enum(['up', 'down']) }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    await requireScheduleLayer(tx!, params);
    const result = await moveScheduleLayerUser(params.layerId, params.userId, body.direction, tx);
    await logV2Audit({
      action: 'schedule.participant.moved',
      entityType: 'SCHEDULE',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: result,
      tx,
    });
    return { data: result };
  },
});
