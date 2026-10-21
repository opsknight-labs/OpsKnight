import 'server-only';
import {
  deleteTeamMembership,
  requireMembershipCoordinates,
  type TeamCommandActor,
} from './administration';

export async function removeTeamMembership(memberId: string, actor: TeamCommandActor) {
  const member = await requireMembershipCoordinates(memberId);
  await deleteTeamMembership(member.teamId, member.userId, actor);
  return member;
}
