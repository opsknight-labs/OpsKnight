import 'server-only';

import prisma from '@/lib/prisma';
import { isAppRole } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';

type ApiKeyIdentity = { id: string; userId: string; scopes: string[] };

export type UserActorSource = {
  id: string;
  role: string;
  status: string;
  teamMemberships: readonly { teamId: string }[];
};

/**
 * Pure canonical mapping from a validated user record to an authorization actor.
 * Keeping this separate lets request-scoped auth resolution load the user and team
 * memberships exactly once without a second user lookup inside resolveUserActor().
 */
export function authorizationActorFromUser(user: UserActorSource): AuthorizationActor | null {
  if (!isAppRole(user.role)) return null;
  if (!['ACTIVE', 'INVITED', 'DISABLED'].includes(user.status)) return null;
  return {
    id: user.id,
    role: user.role,
    status: user.status as AuthorizationActor['status'],
    teamIds: user.teamMemberships.map(membership => membership.teamId),
  };
}

export async function resolveUserActor(userId: string): Promise<AuthorizationActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      status: true,
      teamMemberships: { select: { teamId: true } },
    },
  });
  return user ? authorizationActorFromUser(user) : null;
}

export async function resolveApiKeyActor(
  apiKey: ApiKeyIdentity
): Promise<AuthorizationActor | null> {
  const actor = await resolveUserActor(apiKey.userId);
  if (!actor) return null;
  return { ...actor, apiKey: { id: apiKey.id, scopes: apiKey.scopes } };
}
