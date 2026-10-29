import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { teamParams, teamActor, teamReplayGuard } from '@/lib/api-v2/team-administration';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { requireTeamAccess, setTeamLead, teamLeadInput } from '@/lib/teams/administration';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_READ,
  paramsSchema: teamParams,
  querySchema: z.object({}).strict(),
  scopedFilter: true,
  handler: async context =>
    prisma.$transaction(
      async tx => {
        const team = await requireTeamAccess(tx, context.params.id, teamActor(context), false);
        return {
          data: { teamId: team.id, teamLeadId: team.teamLeadId, revision: team.revision },
          headers: { ...etagHeaders(team.revision), 'Cache-Control': 'no-store' },
        };
      },
      { isolationLevel: 'Serializable' }
    ),
});
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_MANAGE,
  paramsSchema: teamParams,
  querySchema: z.object({}).strict(),
  bodySchema: teamLeadInput,
  scopedFilter: true,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: teamReplayGuard,
  handler: async context => {
    const data = await setTeamLead(context.params.id, context.body, teamActor(context), {
      client: context.tx,
      expectedRevision: requireRevisionIfMatch(context.req),
    });
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});
