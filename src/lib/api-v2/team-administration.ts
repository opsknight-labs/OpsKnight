import { z } from 'zod';
import type { V2RouteContext, V2RouteHandlerResult } from './endpoint';
import { requireTeamAccess } from '@/lib/teams/administration';
import { invalidateSessionSecurityProjection } from '@/lib/session-security-projection';
export const teamParams = z.object({ id: z.string().cuid() }).strict();
export const teamMemberParams = teamParams.extend({ userId: z.string().cuid() }).strict();
export const teamActor = (context: Pick<V2RouteContext, 'actor'>) => ({
  id: context.actor.id,
  ...(context.actor.apiKey ? { apiKey: context.actor.apiKey } : {}),
});
export const teamReplayGuard = async (
  context: Pick<V2RouteContext<{ id: string }>, 'actor' | 'params' | 'tx'>
) => {
  if (!context.tx) throw new Error('Team replay requires a transaction.');
  await requireTeamAccess(context.tx, context.params.id, teamActor(context), true);
};
export function invalidateTeamMemberAfterCommit(
  result: V2RouteHandlerResult<{ userId: string | null }>
) {
  if (!(result instanceof Response) && result.data?.userId)
    invalidateSessionSecurityProjection(result.data.userId);
}
