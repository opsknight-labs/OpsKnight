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
 * Decrypts and validates the encrypted Auth.js JWT. Ordinary and OIDC sessions
 * stay cryptographically pure here; their revocation remains enforced by the
 * existing tokenVersion/user-status check in auth.ts. Explicit extended
 * credential sessions additionally carry a durable per-session revocation
 * fence because their long lifetime requires device-level revocability.
 */
export async function customJwtDecode(params: JWTDecodeParams): Promise<JWT | null> {
  const { token, secret, salt = '' } = params;
  if (!token) return null;
  const encryptionSecret = await getDerivedEncryptionKey(secret, salt);
  try {
    const { payload } = await jwtDecrypt(token, encryptionSecret, { clockTolerance: 15 });

    if (
      payload.rememberMe === true &&
      typeof payload.oidcAuthenticatedAt !== 'number' &&
      typeof payload.trustedSessionStartedAt === 'number'
    ) {
      const { getTrustedPwaSessionMaxAgeSeconds } = await import('@/lib/pwa-session-policy');
      if (
        nowSeconds() >=
        payload.trustedSessionStartedAt + getTrustedPwaSessionMaxAgeSeconds()
      ) {
        return null;
      }
    }

    if (
      payload.rememberMe === true &&
      typeof payload.oidcAuthenticatedAt !== 'number' &&
      typeof payload.sub === 'string' &&
      typeof payload.jti === 'string'
    ) {
      try {
        const { ensureRegisteredSession } = await import('@/lib/session-registry');
        const allowed = await ensureRegisteredSession({
          sessionId: payload.jti,
          userId: payload.sub,
          policy: 'STANDARD',
          expiresAtSeconds: typeof payload.exp === 'number' ? payload.exp : null,
        });
        if (!allowed) return null;
      } catch (error) {
        logger.error('auth.extended_session_registry_lookup_failed', {
          component: 'auth-jwt-encoder',
          sessionId: payload.jti,
          userId: payload.sub,
          error,
        });
        return null;
      }
    }

    return payload as JWT;
  } catch {
    return null;
  }
}
