import 'server-only';

/**
 * Field-name denylist used as a defense-in-depth net over export payloads.
 * The primary defense is that fetchers in domains.ts only ever `select`
 * known-safe columns; this catches accidental additions or refactors that
 * would otherwise widen what a fetcher returns.
 */
const SECRET_KEY_PATTERN =
  /(password|passwordhash|secret|token|apikey|api_key|credential|privatekey|private_key|encryptionkey|encryption_key|\bdek\b|authtag|auth_tag|signingsecret|signing_secret|webhooksecret|webhook_secret|clientsecret|client_secret|payloadencrypted|encryptedpayload|encrypted_payload|sessiontoken|session_token|refreshtoken|refresh_token|accesstoken|access_token|pushtoken|push_token|devicetoken|device_token|verificationtoken|verification_token|otpsecret|otp_secret|mfasecret|mfa_secret|recoverycode|recovery_code|scimsecret|scim_secret|leasetoken|lease_token|claimtoken|claim_token)/i;

export function isSecretLikeKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/**
 * Recursively finds any object key that looks like a credential. Returns the
 * dotted paths of every match so callers (and tests) can assert on exactly
 * what leaked instead of a boolean.
 */
export function findSecretLikeKeys(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];

  const hits: string[] = [];
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);

  for (const [key, child] of entries) {
    const childPath = path ? `${path}.${key}` : key;
    if (!Array.isArray(value) && isSecretLikeKey(key)) {
      hits.push(childPath);
    }
    hits.push(...findSecretLikeKeys(child, childPath));
  }
  return hits;
}

/**
 * Throws if any exported domain accidentally carries a secret-shaped field.
 * Called before an export is zipped, so a serializer bug fails the export
 * instead of shipping a credential to a downloader.
 */
export function assertNoSecretLikeKeys(value: unknown, context: string): void {
  const hits = findSecretLikeKeys(value);
  if (hits.length > 0) {
    throw new Error(
      `Export payload for "${context}" contains secret-shaped field(s): ${hits.join(', ')}`
    );
  }
}
