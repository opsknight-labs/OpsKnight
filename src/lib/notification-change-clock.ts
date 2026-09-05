import prisma from './prisma';

const CLOCK_TTL_MS = 2_000;
let cached: { version: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

/**
 * Replica-wide change clock. Thousands of idle SSE clients share one cheap
 * aggregate read instead of issuing one user-scoped query each.
 */
export async function getNotificationChangeVersion(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.version;
  if (inFlight) return inFlight;
  inFlight = prisma.inAppNotification
    .aggregate({ _max: { createdAt: true, id: true } })
    .then(result => {
      const version = `${result._max.createdAt?.toISOString() ?? 'none'}:${result._max.id ?? ''}`;
      cached = { version, expiresAt: Date.now() + CLOCK_TTL_MS };
      return version;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function clearNotificationChangeClock(): void {
  cached = null;
  inFlight = null;
}
