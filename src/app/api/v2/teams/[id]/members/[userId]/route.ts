import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { AppError } from '@/lib/errors';
import {
  teamMemberParams,
  teamActor,
  teamReplayGuard,
  invalidateTeamMemberAfterCommit,
} from '@/lib/api-v2/team-administration';
import {
  requireTeamAccess,
  setTeamMembership,
  deleteTeamMembership,
  teamMemberInput,
} from '@/lib/teams/administration';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_READ,
  paramsSchema: teamMemberParams,
  querySchema: z.object({}).strict(),
  scopedFilter: true,
  handler: async context =>
    prisma.$transaction(
      async tx => {
        const team = await requireTeamAccess(tx, context.params.id, teamActor(context), false);
        const member = await tx.teamMember.findUnique({
          where: { userId_teamId: { userId: context.params.userId, teamId: team.id } },
          select: {
            id: true,
            teamId: true,
            userId: true,
            role: true,
            receiveTeamNotifications: true,
            createdAt: true,
          },
        });
        if (!member)
          throw new AppError({
            code: 'RESOURCE_NOT_FOUND',
            userMessage: 'Team or membership not found.',
          });
        return {
          data: { ...member, revision: team.revision },
          headers: { ...etagHeaders(team.revision), 'Cache-Control': 'no-store' },
        };
      },
      { isolationLevel: 'Serializable' }
    ),
});
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_MANAGE,
  paramsSchema: teamMemberParams,
  querySchema: z.object({}).strict(),
  bodySchema: teamMemberInput,
  scopedFilter: true,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: teamReplayGuard,
  invalidateAfterCommit: invalidateTeamMemberAfterCommit,
  handler: async context => {
    const data = await setTeamMembership(
      context.params.id,
      context.params.userId,
      context.body,
      teamActor(context),
      { client: context.tx, expectedRevision: requireRevisionIfMatch(context.req) }
    );
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});
export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_MANAGE,
  paramsSchema: teamMemberParams,
  querySchema: z.object({}).strict(),
  scopedFilter: true,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: teamReplayGuard,
  invalidateAfterCommit: invalidateTeamMemberAfterCommit,
  handler: async context => {
    const data = await deleteTeamMembership(
      context.params.id,
      context.params.userId,
      teamActor(context),
      { client: context.tx, expectedRevision: requireRevisionIfMatch(context.req) }
    );
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});
