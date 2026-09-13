import { EncryptJWT, jwtDecrypt } from 'jose';
import hkdf from '@panva/hkdf';
import { v4 as uuidv4 } from 'uuid';
import type { JWT, JWTEncodeParams, JWTDecodeParams } from 'next-auth/jwt';

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

  // Transient database lookup errors must fail closed for the current in-memory request,
  // but must NEVER be persisted into the browser's session cookie. Persisting it poisons
  // the cookie and locks the user in a middleware redirect loop even after the database recovers.
  const payloadToEncrypt: Record<string, unknown> = { ...token };
  if (payloadToEncrypt.error === 'SECURITY_LOOKUP_UNAVAILABLE') {
    delete payloadToEncrypt.error;
  }

  // A session identifier must be stable across Auth.js refresh/re-encode cycles.
  // Rotating jti on every encode makes per-session audit/revocation impossible and
  // falsely turns one browser session into many logical sessions.
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
 * Custom NextAuth JWT decoder that securely decrypts the JWE and validates
 * expiration, clock skew, and signature. Returns null on expired or malformed tokens.
 */
export async function customJwtDecode(params: JWTDecodeParams): Promise<JWT | null> {
  const { token, secret, salt = '' } = params;
  if (!token) return null;
  const encryptionSecret = await getDerivedEncryptionKey(secret, salt);
  try {
    const { payload } = await jwtDecrypt(token, encryptionSecret, {
      clockTolerance: 15,
    });
    return payload as JWT;
  } catch {
    return null;
  }
}
