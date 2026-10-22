import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

const paramsSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    overrideId: z.string().trim().min(1).max(100),
  })
  .strict();

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
