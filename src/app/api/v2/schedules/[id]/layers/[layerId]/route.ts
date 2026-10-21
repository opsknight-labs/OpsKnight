import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { ScheduleLayerParams } from '@/lib/api-v2/schedule-participants';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { deleteScheduleLayer, scheduleLayerUpdateSchema, updateScheduleLayer } from '@/lib/schedules/layer-commands';
import { AppError } from '@/lib/errors';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_READ,
  scopedFilter: true,
  paramsSchema: ScheduleLayerParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const layer = await prisma.onCallLayer.findFirst({
      where: { id: params.layerId, scheduleId: params.id, schedule: scheduleReadWhere(actor) },
      include: { users: { orderBy: { position: 'asc' }, take: 101, select: { userId: true, position: true } } },
    });
    if (!layer) throw new AppError({ code: 'SCHEDULE_LAYER_NOT_FOUND' });
    const { users, ...meta } = layer;
    return {
      data: { ...meta, users: users.slice(0, 100), truncated: users.length > 100 },
      headers: { ...etagHeaders(layer.revision), 'Cache-Control': 'no-store' },
    };
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
  paramsSchema: ScheduleLayerParams,
  querySchema: z.object({}).strict(),
  bodySchema: scheduleLayerUpdateSchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, tx }) => {
    const exists = await tx!.onCallLayer.findFirst({ where: { id: params.layerId, scheduleId: params.id }, select: { id: true } });
    if (!exists) throw new AppError({ code: 'SCHEDULE_LAYER_NOT_FOUND' });
  },
  handler: async ({ params, body, req, actor, apiKey, tx }) => {
    const layer = await updateScheduleLayer(tx!, params.id, params.layerId, {
      name: body.name,
      start: new Date(body.start),
      end: body.end ? new Date(body.end) : null,
      rotationLengthHours: body.rotationLengthHours,
      shiftLengthHours: body.shiftLengthHours,
      restrictions: body.restrictions,
    }, requireRevisionIfMatch(req));
    await logV2Audit({
      action: 'schedule.layer.updated', entityType: 'SCHEDULE', entityId: params.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { layerId: layer.id, name: layer.name }, tx,
    });
    return { data: layer, headers: { ...etagHeaders(layer.revision), 'Cache-Control': 'no-store' } };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
  paramsSchema: ScheduleLayerParams,
  querySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, tx }) => {
    const exists = await tx!.onCallSchedule.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) throw new AppError({ code: 'SCHEDULE_NOT_FOUND' });
  },
  handler: async ({ params, req, actor, apiKey, tx }) => {
    const layer = await deleteScheduleLayer(tx!, params.id, params.layerId, requireRevisionIfMatch(req));
    await logV2Audit({
      action: 'schedule.layer.deleted', entityType: 'SCHEDULE', entityId: params.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { layerId: layer.id, name: layer.name }, tx,
    });
    return { status: 204 };
  },
});
