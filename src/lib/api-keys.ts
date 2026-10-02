import { createHash, createHmac, randomBytes, scrypt } from 'crypto';
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

function hmacTokenV2(token: string, secret: string) {
  // API keys contain 256 random bits and are not user passwords. A keyed,
  // domain-separated lookup hash prevents offline guessing without imposing a
  // password-KDF cost on every authenticated API request.
  // lgtm[js/insufficient-password-hash]
  return createHmac('sha256', secret).update(`opsknight:api-key:v2:${token}`).digest('hex');
}

/**
 * Fast keyed lookup hash. API keys already carry 256 bits of entropy, so a
 * password KDF adds event-loop pressure without improving brute-force safety.
 */
export function hashTokenV2(token: string) {
  return hmacTokenV2(token, getDefaultSecret());
}

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/**
 * HMAC hashes written by 2.0 runtimes that signed API keys with NEXTAUTH_SECRET
 * before an independent API_KEY_SECRET was configured. Introducing
 * API_KEY_SECRET must not invalidate those keys, so callers look them up and
 * re-hash them with the active secret.
 */
export function hashTokenV2LegacyCandidates(token: string): string[] {
  const active = getDefaultSecret();
  const nextAuthSecret = process.env.NEXTAUTH_SECRET;
  return unique([nextAuthSecret, nextAuthSecret?.trim()])
    .filter(secret => secret !== active)
    .map(secret => hmacTokenV2(token, secret));
}

// 1.x issued `ok_` + base64url(32 random bytes); 2.0 tokens carry `ok_live_`/`ok_test_`.
const LEGACY_1X_TOKEN_PATTERN = /^ok_[A-Za-z0-9_-]{43}$/;

export function isLegacy1xTokenShape(token: string): boolean {
  return LEGACY_1X_TOKEN_PATTERN.test(token);
}

/**
 * 1.x derived NEXTAUTH_SECRET from ENCRYPTION_KEY when NEXTAUTH_SECRET was not
 * configured. API keys issued by such installations used that derived value as
 * the scrypt salt, so it remains a lookup candidate after the upgrade.
 */
function deriveLegacyNextAuthSecretFromEncryptionKey(): string | null {
  const seed = process.env.ENCRYPTION_KEY;
  if (!seed || seed.length < 32) return null;
  return createHash('sha256').update(`opsknight:nextauth-secret:v1:${seed}`).digest('base64');
}

/**
 * Publicly shipped 1.x NEXTAUTH_SECRET defaults (Compose, Helm, Kubernetes
 * sample Secret, env.example). 2.0 refuses them as signing secrets, but 1.x
 * installations that never replaced them salted API keys with them. They are
 * safe lookup salts because a match still requires the 256-bit token itself.
 */
const SHIPPED_1X_NEXTAUTH_DEFAULTS = [
  'change_this_to_a_random_secret_in_production',
  'changeme_to_a_secure_random_string',
];

function getLegacyScryptSecrets(): string[] {
  const apiKeySecret = process.env.API_KEY_SECRET;
  const nextAuthSecret = process.env.NEXTAUTH_SECRET;
  const configured = unique([
    apiKeySecret,
    apiKeySecret?.trim(),
    nextAuthSecret,
    nextAuthSecret?.trim(),
    deriveLegacyNextAuthSecretFromEncryptionKey(),
  ]);

  if (configured.length === 0) configured.push(getNextAuthSecretSync());
  return unique([...configured, ...SHIPPED_1X_NEXTAUTH_DEFAULTS]);
}

const scryptAsync = promisify(scrypt);

async function hashLegacyScryptTokenWithSecret(token: string, secret: string): Promise<string> {
  const derived = (await scryptAsync(token, secret, 32)) as Buffer;
  return derived.toString('hex');
}

/**
 * Compute every legacy scrypt hash that can exist across a 1.x -> 2.0 upgrade.
 * 1.x salted scrypt with API_KEY_SECRET, else NEXTAUTH_SECRET (possibly a
 * shipped default), else a secret derived from ENCRYPTION_KEY. Tokens that cannot have been issued by 1.x skip
 * the expensive KDF entirely.
 */
export async function hashLegacyScryptTokenCandidates(token: string): Promise<string[]> {
  if (!isLegacy1xTokenShape(token)) return [];
  return Promise.all(
    getLegacyScryptSecrets().map(secret => hashLegacyScryptTokenWithSecret(token, secret))
  );
}

/** Compute the primary legacy scrypt hash for compatibility callers. */
export async function hashLegacyScryptToken(token: string): Promise<string> {
  return hashLegacyScryptTokenWithSecret(token, getLegacyScryptSecrets()[0]);
}

/**
 * Every non-current hash a valid key may still be stored under. Successful
 * lookups through these candidates must be re-hashed with hashTokenV2.
 */
export async function hashLegacyTokenCandidates(token: string): Promise<string[]> {
  const current = hashTokenV2(token);
  const candidates = [
    ...hashTokenV2LegacyCandidates(token),
    ...(await hashLegacyScryptTokenCandidates(token)),
  ];
  return unique(candidates).filter(hash => hash !== current);
}

export const hashToken = hashTokenV2;
