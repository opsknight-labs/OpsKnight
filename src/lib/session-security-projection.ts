import 'server-only';

import type { Role, UserStatus } from '@prisma/client';
import prisma from '@/lib/prisma';

export type SessionSecurityProjection = {
  userId: string;
  tokenVersion: number;
  status: UserStatus;
  role: Role;
};

type CacheEntry = {
  value: SessionSecurityProjection | null;
  expiresAt: number;
};

const projectionCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SessionSecurityProjection | null>>();

function projectionTtlMs() {
  const configured = Number.parseInt(process.env.SESSION_SECURITY_CACHE_TTL_MS ?? '5000', 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : 5000;
}

/**
 * Minimal revocation projection used by session evaluation. The interface is
 * intentionally storage-agnostic so a distributed cache/control plane can
 * replace the bounded process-local implementation later.
 */
export async function getSessionSecurityProjection(
  userId: string
): Promise<SessionSecurityProjection | null> {
  const cached = projectionCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = inFlight.get(userId);
  if (pending) return pending;

  const lookup = prisma.user
    .findUnique({
      where: { id: userId },
      select: { id: true, tokenVersion: true, status: true, role: true },
    })
    .then(user => {
      const value = user
        ? {
            userId: user.id,
            tokenVersion: user.tokenVersion ?? 0,
            status: user.status,
            role: user.role,
          }
        : null;
      projectionCache.set(userId, { value, expiresAt: Date.now() + projectionTtlMs() });
      return value;
    })
    .finally(() => {
      inFlight.delete(userId);
    });

  inFlight.set(userId, lookup);
  return lookup;
}

export function invalidateSessionSecurityProjection(userId: string) {
  projectionCache.delete(userId);
}

export function invalidateSessionSecurityProjections(userIds: readonly string[]) {
  userIds.forEach(invalidateSessionSecurityProjection);
}

/** Test-only reset for deterministic cache boundary coverage. */
export function resetSessionSecurityProjectionCache() {
  projectionCache.clear();
  inFlight.clear();
}
