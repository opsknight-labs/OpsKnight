import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { advanceUserSessionVersions } from '@/lib/users/admin-invariants';
import { invalidateSessionSecurityProjections } from '@/lib/session-security-projection';
import { hasGroupOverage, oidcRuleMatches } from '@/lib/oidc/role-mapping';
import type { OidcClaims } from '@/lib/oidc/provider-policy';

export type OidcTeamRule = {
  claim: string;
  value: string;
  caseSensitive?: boolean;
  teamId: string;
};

export type TeamReconciliation = {
  added: string[];
  removed: string[];
  /** Claims were incomplete, so nothing was removed. */
  skippedRemovals: boolean;
};

/** The teams a sign-in's claims place the person in, according to the team rules. */
export function desiredOidcTeams(claims: OidcClaims, rules: OidcTeamRule[]): Set<string> {
  return new Set(rules.filter(rule => oidcRuleMatches(claims, rule)).map(rule => rule.teamId));
}

/**
 * Brings a person's SSO-granted team memberships in line with their groups at sign-in.
 *
 * - Adds them as MEMBER to mapped teams they are not already in, recording the grant.
 * - Removes only memberships this mapping granted that are still MEMBER. Manual memberships,
 *   promoted members (the role change released the grant) and SCIM-granted memberships stay.
 * - When the provider says its group list was truncated, nothing is removed.
 */
export async function reconcileOidcTeams(
  userId: string,
  claims: OidcClaims,
  rules: OidcTeamRule[]
): Promise<TeamReconciliation> {
  const existingGrants = await prisma.oidcTeamGrant.count({ where: { userId } });
  if (rules.length === 0 && existingGrants === 0)
    return { added: [], removed: [], skippedRemovals: false };

  const skippedRemovals =
    rules.some(rule => rule.claim.trim().toLowerCase() === 'groups') && hasGroupOverage(claims);
  const wanted = desiredOidcTeams(claims, rules);

  const result = await runSerializableTransaction(async (tx: Prisma.TransactionClient) => {
    const teams = wanted.size
      ? await tx.team.findMany({ where: { id: { in: [...wanted] } }, select: { id: true } })
      : [];
    const desired = new Set(teams.map(team => team.id));
    const memberships = await tx.teamMember.findMany({
      where: { userId },
      select: {
        id: true,
        teamId: true,
        role: true,
        oidcGrant: { select: { id: true } },
        scimGrant: { select: { teamMemberId: true } },
      },
    });
    const byTeam = new Map(memberships.map(member => [member.teamId, member]));
    const additions = [...desired].filter(teamId => !byTeam.has(teamId));
    const obsolete = skippedRemovals
      ? []
      : memberships.filter(member => member.oidcGrant && !desired.has(member.teamId));
    if (additions.length === 0 && obsolete.length === 0) return { added: [], removed: [] };

    // Lock the user before teams, matching local and SCIM administration.
    await advanceUserSessionVersions(tx, [userId]);

    const removed: string[] = [];
    for (const member of obsolete) {
      await tx.oidcTeamGrant.delete({ where: { teamMemberId: member.id } });
      // Another source still wants this membership, or an administrator promoted the member.
      if (member.scimGrant || member.role !== 'MEMBER') continue;
      await tx.teamMember.deleteMany({ where: { id: member.id, role: 'MEMBER' } });
      await tx.team.updateMany({
        where: { id: member.teamId, teamLeadId: userId },
        data: { teamLeadId: null },
      });
      removed.push(member.teamId);
    }
    for (const teamId of additions) {
      const member = await tx.teamMember.create({
        data: { userId, teamId, role: 'MEMBER' },
        select: { id: true },
      });
      await tx.oidcTeamGrant.create({ data: { teamMemberId: member.id, userId, teamId } });
    }
    return { added: additions, removed };
  });
  if (result.added.length || result.removed.length) invalidateSessionSecurityProjections([userId]);
  return { ...result, skippedRemovals };
}
