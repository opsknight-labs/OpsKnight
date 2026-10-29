import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { invitationRenewInput, readUserInvitation } from '@/lib/users/invitation-policy';
import { renewUserInvitation } from '@/lib/users/invitations';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import {
  invitationUserParams,
  prepareInvitationRequest,
  preparedInvitation,
  invitationReplayGuard,
  persistInvitationReceipt,
} from '@/lib/api-v2/user-invitations';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.USER_ADMINISTRATION_READ,
  paramsSchema: invitationUserParams,
  querySchema: z.object({}).strict(),
  handler: async context =>
    prisma.$transaction(
      async tx => {
        const data = await readUserInvitation(tx, context.params.id, context.actor);
        return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
      },
      { isolationLevel: 'Serializable' }
    ),
});
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.USER_MANAGE,
  paramsSchema: invitationUserParams,
  querySchema: z.object({}).strict(),
  bodySchema: invitationRenewInput,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  prepare: prepareInvitationRequest,
  replayAuthGuard: invitationReplayGuard,
  persistIdempotencyResult: persistInvitationReceipt,
  handler: async context => {
    const data = await renewUserInvitation(context.params.id, context.body, context.actor, {
      client: context.tx,
      expectedRevision: requireRevisionIfMatch(context.req),
      prepared: preparedInvitation(context),
    });
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});
