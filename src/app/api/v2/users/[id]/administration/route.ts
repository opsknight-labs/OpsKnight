import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import {
  administerUser,
  requireUserAdministrator,
  userAdministrationInput,
  userAdministrationSelect,
} from '@/lib/users/administration';
import { invalidateSessionSecurityProjection } from '@/lib/session-security-projection';
import { AppError } from '@/lib/errors';
const params = z.object({ id: z.string().cuid() }).strict();
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.USER_ADMINISTRATION_READ,
  paramsSchema: params,
  querySchema: z.object({}).strict(),
  handler: async context =>
    prisma.$transaction(
      async tx => {
        await requireUserAdministrator(tx, context.actor);
        const data = await tx.user.findUnique({
          where: { id: context.params.id },
          select: userAdministrationSelect,
        });
        if (!data)
          throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'User not found.' });
        return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
      },
      { isolationLevel: 'Serializable' }
    ),
});
export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.USER_MANAGE,
  paramsSchema: params,
  querySchema: z.object({}).strict(),
  bodySchema: userAdministrationInput,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async context => {
    if (!context.tx) throw new Error('User administration replay requires a transaction.');
    await requireUserAdministrator(context.tx, context.actor);
  },
  invalidateAfterCommit: result => {
    if (!(result instanceof Response) && result.data)
      invalidateSessionSecurityProjection(result.data.id);
  },
  handler: async context => {
    const data = await administerUser(context.params.id, context.body, context.actor, {
      client: context.tx,
      expectedRevision: requireRevisionIfMatch(context.req),
    });
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});
