import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { invitationCreateInput } from '@/lib/users/invitation-policy';
import { issueUserInvitation } from '@/lib/users/invitations';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import {
  prepareInvitationRequest,
  preparedInvitation,
  invitationReplayGuard,
  persistInvitationReceipt,
} from '@/lib/api-v2/user-invitations';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.USER_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: invitationCreateInput,
  idempotent: true,
  idempotencyRequired: true,
  prepare: prepareInvitationRequest,
  replayAuthGuard: invitationReplayGuard,
  persistIdempotencyResult: persistInvitationReceipt,
  handler: async context => {
    const data = await issueUserInvitation(context.body, context.actor, {
      client: context.tx,
      prepared: preparedInvitation(context),
    });
    return {
      status: 201,
      data,
      headers: {
        ...etagHeaders(data.revision),
        'Cache-Control': 'no-store',
        Location: `/api/v2/users/${data.userId}/invitation`,
      },
    };
  },
});
