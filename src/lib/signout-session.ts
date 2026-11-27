import { logger } from '@/lib/logger';

/**
 * Sign-out clears the cookie in the browser, but the cookie is a bearer: a copy would keep working
 * until it expired. Ending the registered session makes the server refuse it from now on. Best
 * effort, so a failure here never stops the person signing out.
 */
export async function revokeSessionForSignOut(token: { sub?: unknown; jti?: unknown } | null) {
  const userId = typeof token?.sub === 'string' ? token.sub : null;
  const jti = typeof token?.jti === 'string' ? token.jti : null;
  if (!userId || !jti) return;
  try {
    const { revokeRegisteredSession } = await import('@/lib/session-registry');
    await revokeRegisteredSession({ userId, sessionId: jti, currentJti: jti });
  } catch (error) {
    logger.warn('auth.signout.session_revoke_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
