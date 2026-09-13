import 'server-only';

import { cache } from 'react';
import { getServerSession } from 'next-auth';

import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import {
  authorizationActorFromUser,
  type UserActorSource,
} from '@/lib/authorization-actors';
import type { AuthorizationActor } from '@/lib/authorization-policy';

export type AuthenticatedRequestActorContext = {
  session: NonNullable<Awaited<ReturnType<typeof getServerSession>>>;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    status: string;
    avatarUrl: string | null;
    gender: string | null;
    timeZone: string | null;
    tokenVersion: number;
  };
  actor: AuthorizationActor;
};

/**
 * Request-scoped identity/authorization read model for server components.
 * React cache keeps a render tree from repeatedly resolving session + user +
 * team memberships while preserving per-request isolation (no process-global
 * authorization cache).
 */
export const getRequestActorContext = cache(
  async (): Promise<AuthenticatedRequestActorContext | null> => {
    const session = await getServerSession(await getAuthOptions());
    const sessionUserId = session?.user?.id;
    if (!session || !sessionUserId) return null;

    const user = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        avatarUrl: true,
        gender: true,
        timeZone: true,
        tokenVersion: true,
        teamMemberships: { select: { teamId: true } },
      },
    });
    if (!user) return null;

    const actor = authorizationActorFromUser(user satisfies UserActorSource);
    if (!actor || actor.status !== 'ACTIVE') return null;

    return {
      session,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        avatarUrl: user.avatarUrl,
        gender: user.gender,
        timeZone: user.timeZone,
        tokenVersion: user.tokenVersion,
      },
      actor,
    };
  }
);
