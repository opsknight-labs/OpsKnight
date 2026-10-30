import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import { createScheduleLayer, scheduleLayerBodySchema } from '@/lib/schedules/layer-commands';
import { etagHeaders } from '@/lib/api-v2/concurrency';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_READ,
  scopedFilter: true,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const schedule = await prisma.onCallSchedule.findFirst({
      where: { AND: [{ id: params.id }, scheduleReadWhere(actor)] },
      select: {
        id: true,
        revision: true,
        layers: {
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
          take: 101,
          select: {
            id: true,
            name: true,
            revision: true,
            start: true,
            end: true,
            rotationLengthHours: true,
            shiftLengthHours: true,
            restrictions: true,
            priority: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { users: true } },
          },
        },
      },
    });
    if (!schedule) throw new AppError({ code: 'SCHEDULE_NOT_FOUND' });
    return {
      data: {
        scheduleId: schedule.id,
        layers: schedule.layers.slice(0, 100),
        truncated: schedule.layers.length > 100,
      },
      headers: { ...etagHeaders(schedule.revision), 'Cache-Control': 'no-store' },
    };
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: scheduleLayerBodySchema,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, tx }) => {
    const exists = await tx!.onCallSchedule.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!exists) throw new AppError({ code: 'SCHEDULE_NOT_FOUND' });
  },
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const layer = await createScheduleLayer(
      tx!,
      params.id,
      {
        name: body.name,
        start: new Date(body.start),
        end: body.end ? new Date(body.end) : null,
        rotationLengthHours: body.rotationLengthHours,
        shiftLengthHours: body.shiftLengthHours,
        restrictions: body.restrictions,
      },
      body.responderIds
    );
    await logV2Audit({
      action: 'schedule.layer.created',
      entityType: 'SCHEDULE',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { layerId: layer.id, name: layer.name },
      tx,
    });
    return {
      status: 201,
      data: layer,
      headers: { ...etagHeaders(layer.revision), 'Cache-Control': 'no-store' },
    };
  },
});
