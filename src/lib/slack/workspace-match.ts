import prisma from '@/lib/prisma';

/**
 * Enterprise Grid org-wide installs are stored with the enterprise id as workspaceId (and the same id
 * in enterpriseId), so requests arrive with a member workspace's team id. Returns the id events and
 * actions should be matched against: the enterprise id when an enabled org-wide install exists for
 * it, otherwise the team id unchanged (single-workspace installs never take the lookup).
 */
export async function resolveSlackWorkspaceKey(
  teamId: string | null | undefined,
  enterpriseId: string | null | undefined
): Promise<string> {
  const team = typeof teamId === 'string' ? teamId : '';
  if (!enterpriseId || typeof enterpriseId !== 'string') return team;
  const orgWide = await prisma.slackIntegration.findFirst({
    where: { enabled: true, enterpriseId, workspaceId: enterpriseId },
    select: { id: true },
  });
  return orgWide ? enterpriseId : team;
}

/** True when the request's workspace is the incident's workspace, directly or through the org install. */
export async function slackWorkspaceMatches(input: {
  teamId: string | null | undefined;
  enterpriseId: string | null | undefined;
  incidentWorkspaceId: string | null | undefined;
}): Promise<boolean> {
  const { teamId, enterpriseId, incidentWorkspaceId } = input;
  if (!incidentWorkspaceId) return false;
  if (teamId && teamId === incidentWorkspaceId) return true;
  if (!enterpriseId || enterpriseId !== incidentWorkspaceId) return false;
  return (await resolveSlackWorkspaceKey(teamId, enterpriseId)) === incidentWorkspaceId;
}
