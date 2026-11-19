import 'server-only';

import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { AppError } from '@/lib/errors';

/** Sensitive access changes (granting Admin, break-glass) need a sign-in this recent. */
export const ACCESS_STEP_UP_MAX_AGE_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 30_000;

export function isRecentAuthentication(
  authenticatedAt: number | null | undefined,
  maxAgeMs: number = ACCESS_STEP_UP_MAX_AGE_MS,
  now: number = Date.now()
): boolean {
  return (
    typeof authenticatedAt === 'number' &&
    Number.isFinite(authenticatedAt) &&
    authenticatedAt > 0 &&
    authenticatedAt <= now + CLOCK_SKEW_MS &&
    now - authenticatedAt <= maxAgeMs
  );
}

export async function hasRecentAuthentication(maxAgeMs = ACCESS_STEP_UP_MAX_AGE_MS) {
  const session = await getServerSession(await getAuthOptions());
  return isRecentAuthentication(session?.authenticatedAt, maxAgeMs);
}

/** Throws STEP_UP_REQUIRED unless the person signed in within `maxAgeMs`. */
export async function assertRecentAuthentication(
  maxAgeMs = ACCESS_STEP_UP_MAX_AGE_MS,
  reason = 'this change'
) {
  if (await hasRecentAuthentication(maxAgeMs)) return;
  throw new AppError({
    code: 'STEP_UP_REQUIRED',
    userMessage: `For your security, sign in again before ${reason}.`,
    details: { maxAgeMinutes: Math.round(maxAgeMs / 60_000) },
  });
}
