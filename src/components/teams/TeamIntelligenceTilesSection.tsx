import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { getTeamIntelligenceTiles } from '@/lib/intelligence/surfaces/team-tiles';
import TeamIntelligenceTiles from './TeamIntelligenceTiles';

/**
 * Server section for the team page: loads the intelligence tiles for the signed-in actor and renders
 * nothing when the actor may not read intelligence, the load fails, or both tiles are silent. Meant to
 * sit behind a `<Suspense fallback={null}>` so it never delays the rest of the page.
 */
export default async function TeamIntelligenceTilesSection({ teamId }: { teamId: string }) {
  const loaded = await (async () => {
    const actor = await getCurrentAuthorizationActor();
    return {
      tiles: await getTeamIntelligenceTiles(actor, teamId),
      canManage: hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE),
    };
  })().catch(() => null);
  if (!loaded) return null;
  return <TeamIntelligenceTiles tiles={loaded.tiles} canManage={loaded.canManage} />;
}
