import 'server-only';

import prisma from '@/lib/prisma';
import { isAppRole } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';

export type StreamAuthorization = AuthorizationActor & {
  tokenVersion: number;
};

/**
 * Resolve the authorization scope used by a long-lived stream.  Streams must
 * not rely on the scope that was valid only when the connection opened: team
 * membership, role, account status, and token version can all change while a
 * browser keeps an EventSource connection alive.
 */
export async function resolveStreamAuthorization(
  userId: string,
  expectedTokenVersion: number
): Promise<StreamAuthorization | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      status: true,
      tokenVersion: true,
      teamMemberships: { select: { teamId: true } },
    },
  });

  if (
    !user ||
    user.status !== 'ACTIVE' ||
    !isAppRole(user.role) ||
    (user.tokenVersion ?? 0) !== expectedTokenVersion
  ) {
    return null;
  }

  return {
    id: user.id,
    role: user.role,
    status: user.status,
    teamIds: user.teamMemberships.map(membership => membership.teamId),
    tokenVersion: user.tokenVersion ?? 0,
  };
}

export function hasSameStreamAuthorizationScope(
  current: StreamAuthorization,
  next: StreamAuthorization
): boolean {
  if (
    current.id !== next.id ||
    current.role !== next.role ||
    current.tokenVersion !== next.tokenVersion
  ) {
    return false;
  }

  if (current.teamIds.length !== next.teamIds.length) return false;
  const currentTeamIds = new Set(current.teamIds);
  return next.teamIds.every(teamId => currentTeamIds.has(teamId));
}
