import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import {
  ScheduleParticipantParams,
  requireScheduleLayer,
} from '@/lib/api-v2/schedule-participants';
import { removeScheduleLayerUser, moveScheduleLayerUser } from '@/lib/schedules/mutations';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_READ,
  scopedFilter: true,
  paramsSchema: ScheduleParticipantParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const layer = await prisma.onCallLayer.findFirst({
      where: { id: params.layerId, scheduleId: params.id, schedule: scheduleReadWhere(actor) },
      select: {
        id: true,
        scheduleId: true,
        revision: true,
        users: { where: { userId: params.userId }, select: { userId: true, position: true } },
      },
    });
    if (!layer) throw new AppError({ code: 'SCHEDULE_LAYER_NOT_FOUND' });
    const [participant] = layer.users;
    if (!participant) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'Schedule participant not found.',
      });
    }
    return {
      data: {
        scheduleId: layer.scheduleId,
        layerId: layer.id,
        ...participant,
        revision: layer.revision,
      },
      headers: { ...etagHeaders(layer.revision), 'Cache-Control': 'no-store' },
    };
  },
});

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
