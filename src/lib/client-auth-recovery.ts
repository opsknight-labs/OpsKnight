'use client';

export type ClientSessionVerificationResult =
  | 'VALID'
  | 'REVOKED'
  | 'UNAUTHENTICATED'
  | 'TEMPORARILY_UNAVAILABLE';

export function isTerminalSessionError(status: ClientSessionVerificationResult): boolean {
  return status === 'REVOKED' || status === 'UNAUTHENTICATED';
}

export type SessionExpiredListener = (targetUrl: string, surface: 'desktop' | 'mobile') => void;

const sessionExpiredListeners = new Set<SessionExpiredListener>();
let inFlightSessionCheck: Promise<ClientSessionVerificationResult> | null = null;

/**
 * Resolves the surface-appropriate login destination with SessionExpired error flag.
 * Directs mobile responders to /m/login and desktop users to /login.
 */
export function resolveSessionExpiredUrl(surfaceHint?: 'desktop' | 'mobile'): string {
  if (typeof window === 'undefined') {
    return surfaceHint === 'mobile'
      ? '/m/login?error=SessionExpired'
      : '/login?error=SessionExpired';
  }
  const surface: 'desktop' | 'mobile' =
    surfaceHint ?? (window.location.pathname.startsWith('/m') ? 'mobile' : 'desktop');
  return surface === 'mobile' ? '/m/login?error=SessionExpired' : '/login?error=SessionExpired';
}

/**
 * Subscribes a React component or router listener to terminal session-expired events.
 */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

/**
 * Emits a session expired event to active listeners (such as Next.js router handlers)
 * without performing unsafe DOM location.assign or location.href navigations.
 */
export function notifySessionExpired(surfaceHint?: 'desktop' | 'mobile'): string {
  const target = resolveSessionExpiredUrl(surfaceHint);
  if (typeof window === 'undefined') return target;

  const currentPath = window.location.pathname;
  if (currentPath.startsWith('/login') || currentPath.startsWith('/m/login')) {
    return target;
  }

  const surface = target.startsWith('/m/') ? 'mobile' : 'desktop';
  for (const listener of sessionExpiredListeners) {
    try {
      listener(target, surface);
    } catch {}
  }

  return target;
}

/**
 * Alias for notifySessionExpired for compatibility, avoiding location.assign.
 */
export function redirectToSessionExpired(surfaceHint?: 'desktop' | 'mobile'): string {
  return notifySessionExpired(surfaceHint);
}

/**
 * Reset recovery state (useful in test teardown).
 */
export function resetSessionRecoveryState(): void {
  sessionExpiredListeners.clear();
  inFlightSessionCheck = null;
}

/**
 * Validates the current client session against /api/auth/session.
 * Distinguishes:
 * - VALID: user object confirmed present
 * - TEMPORARILY_UNAVAILABLE: transient network failure, offline, 5xx server error, or SECURITY_LOOKUP_UNAVAILABLE
 * - REVOKED: explicitly revoked token, disabled user, or invalid token version
 * - UNAUTHENTICATED: no active session found
 *
 * Concurrent calls are coalesced into a single in-flight request.
 */
export async function verifyClientSession(): Promise<ClientSessionVerificationResult> {
  if (typeof window === 'undefined') return 'VALID';

  // If the browser is offline, it is a network outage, not an auth invalidation.
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'TEMPORARILY_UNAVAILABLE';
  }

  if (inFlightSessionCheck) {
    return inFlightSessionCheck;
  }

  inFlightSessionCheck = (async (): Promise<ClientSessionVerificationResult> => {
    try {
      const response = await fetch(`/api/auth/session?_ts=${Date.now()}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-store',
        },
      });

      // Explicit authentication failure statuses
      if (response.status === 401) {
        return 'UNAUTHENTICATED';
      }
      if (response.status === 403) {
        return 'REVOKED';
      }

      // Transient 5xx server errors should be retried, not treated as auth invalidation
      if (!response.ok) {
        return 'TEMPORARILY_UNAVAILABLE';
      }

      const data = (await response.json().catch(() => null)) as {
        user?: { id?: string; email?: string } | null;
        error?: string;
      } | null;

      if (!data || typeof data !== 'object') {
        return 'UNAUTHENTICATED';
      }

      if (data.user && (data.user.id || data.user.email)) {
        return 'VALID';
      }

      // Check whether auth.ts flagged a transient DB security lookup failure
      if (data.error === 'SECURITY_LOOKUP_UNAVAILABLE') {
        return 'TEMPORARILY_UNAVAILABLE';
      }

      if (
        data.error === 'SESSION_REVOKED' ||
        data.error === 'USER_DISABLED' ||
        data.error === 'USER_NOT_FOUND' ||
        data.error === 'SESSION_EXPIRED'
      ) {
        return 'REVOKED';
      }

      // Any other token error indicates invalid credentials
      if (data.error) {
        return 'REVOKED';
      }

      // Missing user and no explicit error indicates session not found
      return 'UNAUTHENTICATED';
    } catch {
      // Network failures (e.g. DNS failure, connection reset, fetch aborted)
      // must remain retryable and NOT trigger false-positive auth termination.
      return 'TEMPORARILY_UNAVAILABLE';
    } finally {
      inFlightSessionCheck = null;
    }
  })();

  return inFlightSessionCheck;
}
