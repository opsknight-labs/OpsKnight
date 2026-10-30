import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';

const paramsSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    overrideId: z.string().trim().min(1).max(100),
  })
  .strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_READ,
  scopedFilter: true,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    // A missing, foreign or invisible schedule is indistinguishable from a missing override.
    const override = await prisma.onCallOverride.findFirst({
      where: { id: params.overrideId, scheduleId: params.id, schedule: scheduleReadWhere(actor) },
      select: {
        id: true,
        scheduleId: true,
        userId: true,
        replacesUserId: true,
        start: true,
        end: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!override) throw new AppError({ code: 'SCHEDULE_OVERRIDE_NOT_FOUND' });
    return {
      data: { ...override, startDate: override.start, endDate: override.end },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, actor, apiKey, tx }) => {
    const override = await tx!.onCallOverride.findFirst({
      where: { id: params.overrideId, scheduleId: params.id },
      select: { id: true, userId: true, replacesUserId: true },
    });
    if (!override) {
      throw new AppError({ code: 'SCHEDULE_OVERRIDE_NOT_FOUND' });
    }

    const deleted = await tx!.onCallOverride.deleteMany({
      where: { id: params.overrideId, scheduleId: params.id },
    });
    if (deleted.count !== 1) {
      throw new AppError({ code: 'SCHEDULE_OVERRIDE_NOT_FOUND' });
    }

    await logV2Audit({
      action: 'schedule.override.deleted',
      entityType: 'SCHEDULE',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: {
        overrideId: override.id,
        userId: override.userId,
        replacesUserId: override.replacesUserId,
      },
      tx,
    });

    return { data: { id: override.id, cancelled: true } };
  },
});
