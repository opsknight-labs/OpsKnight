import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireUserAdministrator } from '@/lib/users/administration';
import { countUserDependencies } from '@/lib/users/dependencies';
import { AppError } from '@/lib/errors';

const paramsSchema = z.object({ id: z.string().cuid() }).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.USER_ADMINISTRATION_READ,
  paramsSchema,
  querySchema: z.object({}).strict(),
  rateLimitTier: 'READ',
  handler: async context => prisma.$transaction(async tx => {
    await requireUserAdministrator(tx, context.actor);
    const user = await tx.user.findUnique({
      where: { id: context.params.id },
      select: { id: true, revision: true },
    });
    if (!user) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const snapshot = await countUserDependencies(user.id, tx);
    return {
      data: { userId: user.id, userRevision: user.revision, ...snapshot },
      headers: { 'Cache-Control': 'no-store' },
    };
  }, { isolationLevel: 'RepeatableRead', timeout: 10_000 }),
});
