import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { teamParams, teamActor } from '@/lib/api-v2/team-administration';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { listTeamActivity } from '@/lib/teams/activity';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.TEAM_ACTIVITY_READ,
  paramsSchema: teamParams,
  querySchema: z
    .object({ limit: z.string().optional(), cursor: z.string().max(2048).optional() })
    .strict(),
  scopedFilter: true,
  handler: async context =>
    prisma.$transaction(
      async tx => ({
        ...(await listTeamActivity(tx, context.params.id, teamActor(context), context.pagination)),
        headers: { 'Cache-Control': 'no-store' },
      }),
      { isolationLevel: 'Serializable' }
    ),
});
