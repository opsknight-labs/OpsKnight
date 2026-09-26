import { EncryptJWT, jwtDecrypt } from 'jose';
import hkdf from '@panva/hkdf';
import { v4 as uuidv4 } from 'uuid';
import type { JWT, JWTEncodeParams, JWTDecodeParams } from 'next-auth/jwt';
import { logger } from '@/lib/logger';

const DEFAULT_MAX_AGE = 30 * 24 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);

async function getDerivedEncryptionKey(keyMaterial: string | Buffer, salt = '') {
  return await hkdf(
    'sha256',
    keyMaterial,
    salt,
    `NextAuth.js Generated Encryption Key${salt ? ` (${salt})` : ''}`,
    32
  );
}

/**
 * Custom NextAuth JWT encoder that preserves the calculated expiration
 * (token.sessionExpiresAt or token.exp) rather than forcing the global maxAge.
 * This guarantees enterprise SSO session maximums and credential Remember-Me
 * lifespans are enforced cryptographically in the JOSE JWE.
 */
export async function customJwtEncode(params: JWTEncodeParams): Promise<string> {
  const { token = {}, secret, maxAge = DEFAULT_MAX_AGE, salt = '' } = params;
  const encryptionSecret = await getDerivedEncryptionKey(secret, salt);

  const expirationTime =
    typeof token.sessionExpiresAt === 'number' && Number.isFinite(token.sessionExpiresAt)
      ? token.sessionExpiresAt
      : typeof token.exp === 'number' && Number.isFinite(token.exp)
        ? token.exp
        : nowSeconds() + maxAge;

  const payloadToEncrypt: Record<string, unknown> = { ...token };
  if (payloadToEncrypt.error === 'SECURITY_LOOKUP_UNAVAILABLE') delete payloadToEncrypt.error;

  // Auth.js may refresh/re-encode the cookie. Preserve the first issuance
  // boundary so extended responder sessions have an absolute operator-bounded
  // lifetime rather than silently rolling forever.
  if (
    token.rememberMe === true &&
    typeof token.oidcAuthenticatedAt !== 'number' &&
    typeof payloadToEncrypt.trustedSessionStartedAt !== 'number'
  ) {
    payloadToEncrypt.trustedSessionStartedAt = nowSeconds();
  }

  const sessionId =
    typeof token.jti === 'string' && token.jti.length >= 16 && token.jti.length <= 128
      ? token.jti
      : uuidv4();

  return await new EncryptJWT(payloadToEncrypt)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(expirationTime)
    .setJti(sessionId)
    .encrypt(encryptionSecret);
}

/**
 * Decrypts and validates the encrypted Auth.js JWT.
 *
 * Registry enforcement is now universal — every authenticated session (STANDARD,
 * TRUSTED_PWA, OIDC) registers its JTI and is checked against the registry on
 * each decode. This replaces the previous rememberMe-only gate.
 *
 * Security & fault-tolerance model:
 *   'denied'      → session is explicitly revoked or invalid  → reject (null)
 *   'unavailable' → registry DB unreachable                   → fail-closed, reject (null)
 *                   for immediate revocation safety
 *   'allowed'     → session is active                         → continue
 *
 * Activity touch is fire-and-forget — an activity write failure never aborts the request.
 */
export async function customJwtDecode(params: JWTDecodeParams): Promise<JWT | null> {
  const { token, secret, salt = '' } = params;
  if (!token) return null;
  const encryptionSecret = await getDerivedEncryptionKey(secret, salt);
  try {
    const { payload } = await jwtDecrypt(token, encryptionSecret, { clockTolerance: 15 });

    // Enforce absolute maximum age for trusted PWA (extended credential) sessions.
    if (
      payload.rememberMe === true &&
      typeof payload.oidcAuthenticatedAt !== 'number' &&
      typeof payload.trustedSessionStartedAt === 'number'
    ) {
      const { getTrustedPwaSessionMaxAgeSeconds } = await import('@/lib/pwa-session-policy');
      if (nowSeconds() >= payload.trustedSessionStartedAt + getTrustedPwaSessionMaxAgeSeconds()) {
        return null;
      }
    }

    // Universal registry check — applies to every authenticated session.
    if (typeof payload.sub === 'string') {
      if (typeof payload.jti !== 'string' || !payload.jti) {
        // Enforce universal session registry coverage: reject legacy tokens lacking a canonical JTI.
        logger.warn('auth.session_registry.missing_jti', {
          component: 'auth-jwt-encoder',
          userId: payload.sub,
        });
        return null;
      }

      const { ensureRegisteredSession, touchSessionActivity } =
        await import('@/lib/session-registry');

      const policy = typeof payload.oidcAuthenticatedAt === 'number' ? 'OIDC' : 'STANDARD';

      const result = await ensureRegisteredSession({
        sessionId: payload.jti,
        userId: payload.sub,
        policy,
        expiresAtSeconds: typeof payload.exp === 'number' ? payload.exp : null,
        // userAgent is not available in JWTDecodeParams; captured during
        // first authenticated HTTP request via touchSessionActivity instead.
      });

      if (result !== 'allowed') {
        // Enforce fail-closed security: if the session is explicitly revoked ('denied')
        // or the registry database cannot be reached ('unavailable'), reject the session.
        logger.warn('auth.session_registry.rejected', {
          component: 'auth-jwt-encoder',
          userId: payload.sub,
          sessionId: payload.jti,
          reason: result,
        });
        return null;
      }

      // Allowed — fire-and-forget activity touch. Never awaited so registry
      // write latency never adds to the critical authentication path.
      void touchSessionActivity({
        userId: payload.sub,
        sessionId: payload.jti,
        // userAgent unavailable here; updated via HTTP request headers in
        // touchSessionActivity calls from API routes.
      });
    }

    return payload as JWT;
  } catch {
    return null;
  }
}
