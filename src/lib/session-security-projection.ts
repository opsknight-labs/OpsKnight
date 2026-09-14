import 'server-only';

import type { Role, UserStatus } from '@prisma/client';
import prisma from '@/lib/prisma';

export type SessionSecurityProjection = {
  userId: string;
  tokenVersion: number;
  status: UserStatus;
  role: Role;
};

export type SessionProfileProjection = {
  userId: string;
  tokenVersion: number;
  status: UserStatus;
  role: Role;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  gender: string | null;
};

type CacheEntry = {
  value: SessionSecurityProjection | null;
  expiresAt: number;
};

type InFlightEntry = {
  epoch: number;
  promise: Promise<SessionSecurityProjection | null>;
};

const projectionCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, InFlightEntry>();
const userEpoch = new Map<string, number>();

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

  const currentEpoch = userEpoch.get(userId) ?? 0;
  const pending = inFlight.get(userId);
  if (pending && pending.epoch === currentEpoch) {
    return pending.promise;
  }

  const inFlightRef: InFlightEntry = {
    epoch: currentEpoch,
    promise: prisma.user
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
        // Discard stale in-flight results if invalidation occurred while resolving
        if ((userEpoch.get(userId) ?? 0) === currentEpoch) {
          projectionCache.set(userId, { value, expiresAt: Date.now() + projectionTtlMs() });
        }
        return value;
      })
      .finally(() => {
        if (inFlight.get(userId) === inFlightRef) {
          inFlight.delete(userId);
        }
      }),
  };

  inFlight.set(userId, inFlightRef);
  return inFlightRef.promise;
}

/**
 * Explicit profile projection read used only when profile data is refreshed
 * (e.g. after avatar, name, or settings update). Does NOT populate the security
 * cache to prevent stale data races across invalidations.
 */
export async function getSessionProfileProjection(
  userId: string
): Promise<SessionProfileProjection | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tokenVersion: true,
      status: true,
      role: true,
      name: true,
      email: true,
      avatarUrl: true,
      gender: true,
    },
  });

  if (!user) return null;

  return {
    userId: user.id,
    tokenVersion: user.tokenVersion ?? 0,
    status: user.status,
    role: user.role,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    gender: user.gender,
  };
}

export function invalidateSessionSecurityProjection(userId: string) {
  userEpoch.set(userId, (userEpoch.get(userId) ?? 0) + 1);
  projectionCache.delete(userId);
}

export function invalidateSessionSecurityProjections(userIds: readonly string[]) {
  userIds.forEach(invalidateSessionSecurityProjection);
}

/** Test-only reset for deterministic cache boundary coverage. */
export function resetSessionSecurityProjectionCache() {
  projectionCache.clear();
  inFlight.clear();
  userEpoch.clear();
}

