import 'server-only';

import prisma from '@/lib/prisma';
import { isAppRole } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  effectiveAccessSelect,
  resolveEffectiveAccess,
  type ActiveGrantSource,
  type CustomRoleSource,
} from '@/lib/access/effective';
import { accessPolicySnapshot, getAccessControlSettings } from '@/lib/access/settings';

type ApiKeyIdentity = { id: string; userId: string; scopes: string[] };

export type UserActorSource = {
  id: string;
  role: string;
  status: string;
  teamMemberships: readonly { teamId: string }[];
  /** Optional: when loaded, custom-role permissions are applied. */
  customRole?: CustomRoleSource;
  /** Optional: when loaded, active temporary grants are applied. */
  accessGrants?: readonly ActiveGrantSource[];
};

/**
 * Pure canonical mapping from a validated user record to an authorization actor.
 * Keeping this separate lets request-scoped auth resolution load the user and team
 * memberships exactly once without a second user lookup inside resolveUserActor().
 *
 * Custom roles and temporary grants only take effect when the caller loaded them (see
 * `effectiveAccessSelect`); without them the actor carries exactly its built-in role.
 */
export function authorizationActorFromUser(user: UserActorSource): AuthorizationActor | null {
  if (!isAppRole(user.role)) return null;
  if (!['ACTIVE', 'INVITED', 'DISABLED'].includes(user.status)) return null;
  const access = resolveEffectiveAccess(
    { role: user.role, customRole: user.customRole, accessGrants: user.accessGrants },
    accessPolicySnapshot()
  );
  return {
    id: user.id,
    role: access.role,
    status: user.status as AuthorizationActor['status'],
    teamIds: (user.teamMemberships ?? []).map(membership => membership.teamId),
    capabilities: access.capabilities,
    ...(access.elevatedIncidentIds.length > 0
      ? { elevatedIncidentIds: access.elevatedIncidentIds }
      : {}),
  };
}

export async function resolveUserActor(userId: string): Promise<AuthorizationActor | null> {
  await getAccessControlSettings();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      status: true,
      teamMemberships: { select: { teamId: true } },
      ...effectiveAccessSelect(),
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
