import 'server-only';

import { cache } from 'react';
import { getServerSession, type Session } from 'next-auth';

import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { authorizationActorFromUser, type UserActorSource } from '@/lib/authorization-actors';
import type { AuthorizationActor } from '@/lib/authorization-policy';

export type AuthenticatedRequestActorContext = {
  session: Session;
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
    const sessionUserEmail = session?.user?.email;
    if (!session || (!sessionUserId && !sessionUserEmail)) return null;

    const user = await prisma.user.findUnique({
      where: sessionUserId ? { id: sessionUserId } : { email: sessionUserEmail! },
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

    if (user.status !== 'ACTIVE') return null;

    const sessionTokenVersion = session?.user?.tokenVersion;
    if (
      typeof sessionTokenVersion === 'number' &&
      (user.tokenVersion ?? 0) !== sessionTokenVersion
    ) {
      return null;
    }

    const actor = authorizationActorFromUser(user satisfies UserActorSource);
    if (!actor || actor.status !== 'ACTIVE') return null;

    const sessionId = session.user?.sessionId || session.sessionId;
    if (sessionId) {
      void (async () => {
        let userAgent: string | null = null;
        try {
          const { headers } = await import('next/headers');
          const headerStore = await headers();
          userAgent = headerStore.get('user-agent');
        } catch {
          // Ignored outside request context
        }
        const { touchAuthenticatedSession } = await import('@/lib/session-registry');
        await touchAuthenticatedSession({
          userId: user.id,
          sessionId,
          userAgent,
        });
      })();
    }

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
