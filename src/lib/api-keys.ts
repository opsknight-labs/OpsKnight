import { createHmac, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import { getNextAuthSecretSync } from './secret-manager';

const API_KEY_SECRET_DERIVATION_CONTEXT = 'opsknight:api-key:root:v1';

function getConfiguredApiKeySecret(): string | null {
  const value = process.env.API_KEY_SECRET;
  return value && value.length > 0 ? value : null;
}

function getSessionSecret(): string {
  return getNextAuthSecretSync();
}

/**
 * Keep API-key hashing in a cryptographic domain separate from session JWTs.
 * Operators can provide an independent API_KEY_SECRET; otherwise derive a
 * dedicated key from NEXTAUTH_SECRET instead of using the session secret
 * directly as the HMAC key.
 */
function getPrimaryApiKeySecret(): string {
  const configured = getConfiguredApiKeySecret();
  if (configured) return configured;

  return createHmac('sha256', getSessionSecret())
    .update(API_KEY_SECRET_DERIVATION_CONTEXT)
    .digest('hex');
}

/**
 * Hashing secrets used by older releases. These are lookup-only and allow
 * successful requests to migrate stored hashes to the current V2 key without
 * forcing an immediate API-key rotation during upgrade.
 */
function getLegacyLookupSecrets(): string[] {
  return [...new Set([getConfiguredApiKeySecret(), getSessionSecret()].filter(Boolean) as string[])];
}

function hashV2WithSecret(token: string, secret: string): string {
  return createHmac('sha256', secret).update(`opsknight:api-key:v2:${token}`).digest('hex');
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
  return createHmac('sha256', getPrimaryApiKeySecret())
    .update(`opsknight:api-key:v1:${token}`)
    .digest('hex');
}

/**
 * Fast keyed lookup hash. API keys already carry 256 bits of entropy, so a
 * password KDF adds event-loop pressure without improving brute-force safety.
 */
export function hashTokenV2(token: string) {
  // API keys contain 256 random bits and are not user passwords. A keyed,
  // domain-separated lookup hash prevents offline guessing without imposing a
  // password-KDF cost on every authenticated API request.
  // lgtm[js/insufficient-password-hash]
  return hashV2WithSecret(token, getPrimaryApiKeySecret());
}

/**
 * V2 hashes written before API-key/session-secret domain separation. The
 * current primary hash is excluded so callers only perform compatibility work
 * when there is a genuinely different legacy representation to check.
 */
export function hashLegacyV2Tokens(token: string): string[] {
  const current = hashTokenV2(token);
  return [
    ...new Set(
      getLegacyLookupSecrets()
        .map(secret => hashV2WithSecret(token, secret))
        .filter(hash => hash !== current)
    ),
  ];
}

const scryptAsync = promisify(scrypt);

async function hashScryptWithSecret(token: string, secret: string): Promise<string> {
  const derived = (await scryptAsync(token, secret, 32)) as Buffer;
  return derived.toString('hex');
}

/** Compute all hashes written by releases that used synchronous scrypt. */
export async function hashLegacyScryptTokens(token: string): Promise<string[]> {
  return Promise.all(getLegacyLookupSecrets().map(secret => hashScryptWithSecret(token, secret)));
}

/**
 * Backward-compatible single-hash helper retained for older callers/tests.
 * New authentication code should check hashLegacyScryptTokens().
 */
export async function hashLegacyScryptToken(token: string): Promise<string> {
  const [hash] = await hashLegacyScryptTokens(token);
  if (!hash) throw new Error('No API-key lookup secret is available');
  return hash;
}

export const hashToken = hashTokenV2;
