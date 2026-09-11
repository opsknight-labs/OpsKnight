const MAX_KEYRING_LENGTH = 16_384;
const MAX_KEYRING_ENTRIES = 64;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

export type EncryptionKeyValidationResult =
  | { valid: true; format: 'single' | 'keyring'; entryCount: number }
  | { valid: false; reason: string };

/**
 * Parse ENCRYPTION_KEY / ENCRYPTION_KEYS without a backtracking-prone compound
 * regular expression. The keyring grammar is deliberately small and bounded:
 * `id:64-hex-key[,id:64-hex-key...]`.
 */
export function validateEncryptionKeyConfiguration(
  value: string | null | undefined
): EncryptionKeyValidationResult {
  if (!value) return { valid: false, reason: 'missing' };
  if (value.length > MAX_KEYRING_LENGTH) return { valid: false, reason: 'too-large' };
  if (value !== value.trim()) return { valid: false, reason: 'surrounding-whitespace' };

  // Legacy ENCRYPTION_KEY remains supported as one raw 32-byte hexadecimal key.
  if (HEX_KEY_PATTERN.test(value)) {
    return { valid: true, format: 'single', entryCount: 1 };
  }

  const entries = value.split(',');
  if (entries.length === 0 || entries.length > MAX_KEYRING_ENTRIES) {
    return { valid: false, reason: 'invalid-entry-count' };
  }

  const keyIds = new Set<string>();
  for (const entry of entries) {
    if (!entry) return { valid: false, reason: 'invalid-separator' };
    if (entry !== entry.trim()) return { valid: false, reason: 'invalid-whitespace' };

    const separator = entry.indexOf(':');
    if (separator <= 0 || separator !== entry.lastIndexOf(':')) {
      return { valid: false, reason: 'invalid-separator' };
    }

    const id = entry.slice(0, separator);
    const key = entry.slice(separator + 1);
    if (!KEY_ID_PATTERN.test(id)) return { valid: false, reason: 'invalid-key-id' };
    if (!HEX_KEY_PATTERN.test(key)) return { valid: false, reason: 'invalid-key' };
    if (keyIds.has(id)) return { valid: false, reason: 'duplicate-key-id' };
    keyIds.add(id);
  }

  return { valid: true, format: 'keyring', entryCount: entries.length };
}
