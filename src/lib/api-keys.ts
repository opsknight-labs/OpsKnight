import { createHmac, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import { getNextAuthSecretSync } from './secret-manager';

function getDefaultSecret(): string {
  return process.env.API_KEY_SECRET || getNextAuthSecretSync();
}

export function generateApiKey() {
  const raw = randomBytes(32).toString('base64url');
  const environment = process.env.NODE_ENV === 'production' ? 'live' : 'test';
  const token = `ok_${environment}_${raw}`;
  return {
    token,
    prefix: token.slice(0, 12),
    tokenHash: hashTokenV2(token),
  };
}

/**
 * Compatibility HMAC namespace retained for callers that need a distinct
 * legacy identifier without performing expensive password hashing.
 */
export function hashTokenV1(token: string) {
  const secret = getDefaultSecret();
  return createHmac('sha256', secret).update(`opsknight:api-key:v1:${token}`).digest('hex');
}

/**
 * Fast keyed lookup hash. API keys already carry 256 bits of entropy, so a
 * password KDF adds event-loop pressure without improving brute-force safety.
 */
export function hashTokenV2(token: string) {
  const secret = getDefaultSecret();
  // API keys contain 256 random bits and are not user passwords. A keyed,
  // domain-separated lookup hash prevents offline guessing without imposing a
  // password-KDF cost on every authenticated API request.
  // lgtm[js/insufficient-password-hash]
  return createHmac('sha256', secret).update(`opsknight:api-key:v2:${token}`).digest('hex');
}

const scryptAsync = promisify(scrypt);

function getLegacyScryptSecrets(): string[] {
  const configured = [
    process.env.API_KEY_SECRET?.trim(),
    process.env.NEXTAUTH_SECRET?.trim(),
  ].filter((value): value is string => Boolean(value));

  if (configured.length === 0) configured.push(getNextAuthSecretSync());
  return [...new Set(configured)];
}

async function hashLegacyScryptTokenWithSecret(token: string, secret: string): Promise<string> {
  const derived = (await scryptAsync(token, secret, 32)) as Buffer;
  return derived.toString('hex');
}

/**
 * Compute every legacy scrypt hash that can exist across a 1.x -> 2.0 upgrade.
 * 1.x installations without API_KEY_SECRET used NEXTAUTH_SECRET as the salt.
 */
export async function hashLegacyScryptTokenCandidates(token: string): Promise<string[]> {
  return Promise.all(
    getLegacyScryptSecrets().map(secret => hashLegacyScryptTokenWithSecret(token, secret))
  );
}

/** Compute the primary legacy scrypt hash for compatibility callers. */
export async function hashLegacyScryptToken(token: string): Promise<string> {
  const [hash] = await hashLegacyScryptTokenCandidates(token);
  return hash;
}

export const hashToken = hashTokenV2;
