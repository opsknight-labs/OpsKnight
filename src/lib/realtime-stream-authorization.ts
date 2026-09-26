import 'server-only';

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import prisma from '@/lib/prisma';
import { isAppRole } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getNextAuthSecret } from '@/lib/secret-manager';
import { SESSION_TOKEN_COOKIE_NAME, useSecureCookies } from '@/lib/auth-cookies';
import { customJwtDecode } from '@/lib/auth-jwt-encoder';
import { isSessionActive } from '@/lib/session-registry';

export type StreamAuthorization = AuthorizationActor & {
  tokenVersion: number;
  sessionJti: string;
};

/**
 * Extracts the current JWT's JTI from incoming SSE connection request headers/cookies.
 */
export async function getRequestSessionJti(req: NextRequest): Promise<string | null> {
  try {
    const token = await getToken({
      req,
      secret: await getNextAuthSecret(),
      cookieName: SESSION_TOKEN_COOKIE_NAME,
      secureCookie: useSecureCookies,
      decode: customJwtDecode,
    });
    return typeof token?.jti === 'string' ? token.jti : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the authorization scope used by a long-lived stream. Streams must
 * not rely on the scope that was valid only when the connection opened: team
 * membership, role, account status, token version, and individual session revocation
 * can all change while a browser keeps an EventSource connection alive.
 *
 * Security property: Fails closed. If the session has been revoked, expired,
 * lacks a valid JTI, or the database cannot be contacted, returns null, immediately
 * severing the stream.
 */
export async function resolveStreamAuthorization(
  userId: string,
  expectedTokenVersion: number,
  sessionJti?: string | null
): Promise<StreamAuthorization | null> {
  // Enforce canonical JTI session registry: stream connections without a valid session JTI
  // are rejected immediately rather than bypassing the session registry.
  if (!sessionJti) {
    return null;
  }

  try {
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

    // Enforce individual session revocation and expiry for this connection
    const active = await isSessionActive(user.id, sessionJti);
    if (!active) {
      return null;
    }

    return {
      id: user.id,
      role: user.role,
      status: user.status,
      teamIds: user.teamMemberships.map(membership => membership.teamId),
      tokenVersion: user.tokenVersion ?? 0,
      sessionJti,
    };
  } catch {
    return null; // Fail closed if database unreachable
  }
}

export function hasSameStreamAuthorizationScope(
  current: StreamAuthorization,
  next: StreamAuthorization
): boolean {
  if (
    current.id !== next.id ||
    current.role !== next.role ||
    current.tokenVersion !== next.tokenVersion ||
    current.sessionJti !== next.sessionJti
  ) {
    return false;
  }

  if (current.teamIds.length !== next.teamIds.length) return false;
  const currentTeamIds = new Set(current.teamIds);
  return next.teamIds.every(teamId => currentTeamIds.has(teamId));
}
