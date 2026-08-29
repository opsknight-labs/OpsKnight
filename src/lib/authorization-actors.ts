import 'server-only';

import prisma from '@/lib/prisma';
import { isAppRole } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';

type ApiKeyIdentity = { id: string; userId: string; scopes: string[] };

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
  if (!user || !isAppRole(user.role)) return null;
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    teamIds: user.teamMemberships.map(membership => membership.teamId),
  };
}

export async function resolveApiKeyActor(
  apiKey: ApiKeyIdentity
): Promise<AuthorizationActor | null> {
  const actor = await resolveUserActor(apiKey.userId);
  if (!actor) return null;
  return { ...actor, apiKey: { id: apiKey.id, scopes: apiKey.scopes } };
}
