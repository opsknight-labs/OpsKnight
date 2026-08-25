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
  return createHmac('sha256', secret).update(`opsknight:api-key:v2:${token}`).digest('hex');
}

const scryptAsync = promisify(scrypt);

/** Compute hashes written by releases that used synchronous scrypt. */
export async function hashLegacyScryptToken(token: string): Promise<string> {
  const derived = (await scryptAsync(token, getDefaultSecret(), 32)) as Buffer;
  return derived.toString('hex');
}

export const hashToken = hashTokenV2;
