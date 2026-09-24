'use client';

let isRedirecting = false;
let inFlightSessionCheck: Promise<boolean> | null = null;

/**
 * Perform a terminal redirect to the login page when a session is revoked or expired.
 * Deduplicated to prevent multiple redirect attempts from competing streams/components.
 */
export function redirectToSessionExpired(): void {
  if (typeof window === 'undefined') return;
  if (isRedirecting) return;
  if (window.location.pathname.startsWith('/login')) return;

  isRedirecting = true;
  const target = '/login?error=SessionExpired';
  window.location.assign(target);
}

/**
 * Reset redirect state (useful in tests).
 */
export function resetSessionRecoveryState(): void {
  isRedirecting = false;
  inFlightSessionCheck = null;
}

/**
 * Validates the current client session against /api/auth/session.
 * Returns:
 * - true if the session is confirmed valid OR if the network/server is experiencing transient errors.
 * - false ONLY if the server indicates the session is invalid, revoked, or unauthenticated.
 *
 * Concurrent calls are coalesced into a single in-flight request.
 */
export async function verifyClientSession(): Promise<boolean> {
  if (typeof window === 'undefined') return true;

  // If the browser is offline, it is a network outage, not an auth invalidation.
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }

  if (inFlightSessionCheck) {
    return inFlightSessionCheck;
  }

  inFlightSessionCheck = (async () => {
    try {
      const response = await fetch(`/api/auth/session?_ts=${Date.now()}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-store',
        },
      });

      // Explicit authentication failure statuses
      if (response.status === 401 || response.status === 403) {
        return false;
      }

      // Transient 5xx server errors should be retried, not treated as auth invalidation
      if (!response.ok) {
        return true;
      }

      const data = await response.json().catch(() => null);

      // In NextAuth, invalidated/revoked tokens result in an empty session object or a session with no user
      if (!data || typeof data !== 'object' || !data.user || (!data.user.id && !data.user.email)) {
        return false;
      }

      return true;
    } catch {
      // Network failures (e.g. DNS failure, connection reset, fetch aborted)
      // must remain retryable and NOT trigger false-positive auth termination.
      return true;
    } finally {
      inFlightSessionCheck = null;
    }
  })();

  return inFlightSessionCheck;
}
