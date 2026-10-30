import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { readInvitationPolicy } from '@/lib/users/invitation-policy';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.USER_ADMINISTRATION_READ,
  querySchema: z.object({}).strict(),
  handler: async context => ({
    data: await prisma.$transaction(tx => readInvitationPolicy(tx, context.actor), {
      isolationLevel: 'Serializable',
    }),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
