import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { teamParams, teamActor, teamReplayGuard } from '@/lib/api-v2/team-administration';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { assignTeamServices } from '@/lib/teams/service-commands';
import { AppError } from '@/lib/errors';
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_MANAGE,
  paramsSchema: teamParams.extend({ serviceId: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  scopedFilter: true,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async context => {
    await teamReplayGuard(context);
    const principal = await context.tx!.user.findUniqueOrThrow({
      where: { id: context.actor.id },
      select: { role: true },
    });
    const service = await context.tx!.service.findUnique({
      where: { id: context.params.serviceId },
      select: { teamId: true },
    });
    if (!service || (principal.role !== 'ADMIN' && service.teamId !== context.params.id))
      throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  },
  handler: async context => {
    const [data] = await assignTeamServices(
      context.params.id,
      { serviceIds: [context.params.serviceId] },
      teamActor(context),
      { client: context.tx, expectedServiceRevision: requireRevisionIfMatch(context.req) }
    );
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});
