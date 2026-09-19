/**
 * Ciphertext inspector.
 * Classifies stored database secrets without leaking secret material or plaintext.
 */

import { decryptWithKey } from '../encryption';
import { CiphertextClassification, EncryptionTargetDefinition } from './types';

export interface InspectionResult {
  classification: CiphertextClassification;
  detectedKeyId: string | null;
  details?: string;
}

/**
 * Canonicalize keyring entries by unique cryptographic key material for legacy decryption.
 * If multiple entries share the exact same key material (e.g. env key k1 and database_legacy,
 * or duplicate environment keys), we test that key material only once.
 * Preference order for resolving canonical identity:
 *   1. Environment keys over database_legacy
 *   2. The active key (if it shares key material)
 *   3. The first occurring entry in the keyring
 */
export function getUniqueLegacyKeyCandidates(
  keyring: Array<{ id: string; key: string }>,
  activeKeyId?: string | null
): Array<{ id: string; key: string }> {
  const byKeyMaterial = new Map<string, { id: string; key: string }>();

  for (const entry of keyring) {
    const existing = byKeyMaterial.get(entry.key);
    if (!existing) {
      byKeyMaterial.set(entry.key, entry);
    } else {
      // If the existing entry was database_legacy and current is an env key, prefer the env key
      if (existing.id === 'database_legacy' && entry.id !== 'database_legacy') {
        byKeyMaterial.set(entry.key, entry);
      } else if (entry.id === activeKeyId && existing.id !== activeKeyId) {
        byKeyMaterial.set(entry.key, entry);
      }
    }
  }

  return Array.from(byKeyMaterial.values());
}

/**
 * Inspect a single raw ciphertext or plaintext string.
 */
export async function inspectValue(
  value: string | null | undefined,
  plaintextLegacyAllowed: boolean,
  keyring: Array<{ id: string; key: string }>,
  activeKeyId: string | null
): Promise<InspectionResult> {
  if (value === null || value === undefined || value.trim() === '') {
    return { classification: 'EMPTY', detectedKeyId: null };
  }

  const trimmed = value.trim();

  // 1. Authenticated v3 format: v3:<keyId>:dekIv:encryptedDek:dekTag:payloadIv:encryptedPayload:payloadTag
  if (trimmed.startsWith('v3:')) {
    const parts = trimmed.split(':');
    if (parts.length === 8 && parts[1]) {
      const keyId = parts[1];
      const matchedKey = keyring.find(k => k.id === keyId);
      if (matchedKey) {
        // Cryptographically validate AES-GCM envelope and authentication tag
        try {
          await decryptWithKey(trimmed, matchedKey.key);
        } catch {
          return {
            classification: 'UNREADABLE',
            detectedKeyId: keyId,
            details: 'Failed cryptographic authentication/decryption of v3 payload',
          };
        }
        if (keyId === activeKeyId) {
          return { classification: 'CURRENT_V3', detectedKeyId: keyId };
        }
        return { classification: 'OLD_KEY_V3', detectedKeyId: keyId };
      }
      return { classification: 'UNAVAILABLE_KEY', detectedKeyId: keyId };
    }
    return { classification: 'UNREADABLE', detectedKeyId: null, details: 'Malformed v3 envelope' };
  }

  // 2. Legacy v2 format: v2:dekIv:encryptedDek:payloadIv:encryptedPayload
  if (trimmed.startsWith('v2:')) {
    const legacyCandidates = getUniqueLegacyKeyCandidates(keyring, activeKeyId);
    const matchingKeys: string[] = [];
    for (const entry of legacyCandidates) {
      try {
        await decryptWithKey(trimmed, entry.key);
        matchingKeys.push(entry.id);
      } catch {
        // Did not decrypt with this key
      }
    }

    if (matchingKeys.length === 1) {
      return { classification: 'LEGACY_V2', detectedKeyId: matchingKeys[0] };
    }
    if (matchingKeys.length > 1) {
      return {
        classification: 'AMBIGUOUS',
        detectedKeyId: null,
        details: 'Matches multiple legacy keys',
      };
    }
    return {
      classification: 'UNREADABLE',
      detectedKeyId: null,
      details: 'Cannot decrypt v2 with any key',
    };
  }

  // 3. Legacy v1 format: iv:ciphertext (hex)
  const isV1Format = /^[0-9a-f]{32}:[0-9a-f]+$/i.test(trimmed);
  if (isV1Format) {
    const legacyCandidates = getUniqueLegacyKeyCandidates(keyring, activeKeyId);
    const matchingKeys: string[] = [];
    for (const entry of legacyCandidates) {
      try {
        await decryptWithKey(trimmed, entry.key);
        matchingKeys.push(entry.id);
      } catch {
        // Did not decrypt with this key
      }
    }

    if (matchingKeys.length === 1) {
      return { classification: 'LEGACY_V1', detectedKeyId: matchingKeys[0] };
    }
    if (matchingKeys.length > 1) {
      return {
        classification: 'AMBIGUOUS',
        detectedKeyId: null,
        details: 'Matches multiple legacy keys',
      };
    }
    return {
      classification: 'UNREADABLE',
      detectedKeyId: null,
      details: 'Cannot decrypt v1 with any key',
    };
  }

  // 4. Plaintext fallback
  if (plaintextLegacyAllowed) {
    return { classification: 'PLAINTEXT', detectedKeyId: null };
  }

  return {
    classification: 'UNREADABLE',
    detectedKeyId: null,
    details: 'Unrecognized format in secret field',
  };
}

/**
 * Inspect a record field based on its target definition.
 */
export async function inspectTargetRecord(
  record: Record<string, unknown>,
  target: EncryptionTargetDefinition,
  keyring: Array<{ id: string; key: string }>,
  activeKeyId: string | null
): Promise<InspectionResult[]> {
  const rawValue = record[target.field];

  if (target.storageType === 'SCALAR' || target.storageType === 'USER_DEVICE_TOKEN') {
    const strVal = typeof rawValue === 'string' ? rawValue : null;
    const result = await inspectValue(strVal, target.plaintextLegacyAllowed, keyring, activeKeyId);
    return [result];
  }

  if (target.storageType === 'JSON_FIELD') {
    if (!rawValue || typeof rawValue !== 'object') {
      return [{ classification: 'EMPTY', detectedKeyId: null }];
    }

    const rawObj = rawValue as Record<string, unknown>;
    const results: InspectionResult[] = [];
    const jsonKeys = target.jsonKeys || [];

    for (const key of jsonKeys) {
      if (Object.prototype.hasOwnProperty.call(rawObj, key)) {
        const fieldVal = Reflect.get(rawObj, key);
        if (fieldVal !== undefined && fieldVal !== null && fieldVal !== '') {
          let valToInspect = String(fieldVal);
          // Remove enc: prefix if present
          if (valToInspect.startsWith('enc:')) {
            valToInspect = valToInspect.slice(4);
          }
          const res = await inspectValue(
            valToInspect,
            target.plaintextLegacyAllowed,
            keyring,
            activeKeyId
          );
          results.push(res);
        }
      }
    }

    if (target.nestedArrayPaths) {
      for (const nested of target.nestedArrayPaths) {
        if (Object.prototype.hasOwnProperty.call(rawObj, nested.arrayField)) {
          const arr = Reflect.get(rawObj, nested.arrayField);
          if (Array.isArray(arr)) {
            for (const item of arr) {
              if (
                item &&
                typeof item === 'object' &&
                Object.prototype.hasOwnProperty.call(item, nested.itemField)
              ) {
                const itemVal = Reflect.get(item as Record<string, unknown>, nested.itemField);
                if (itemVal !== undefined && itemVal !== null && itemVal !== '') {
                  let valToInspect = String(itemVal);
                  if (valToInspect.startsWith('enc:')) {
                    valToInspect = valToInspect.slice(4);
                  }
                  const res = await inspectValue(
                    valToInspect,
                    target.plaintextLegacyAllowed,
                    keyring,
                    activeKeyId
                  );
                  results.push(res);
                }
              }
            }
          }
        }
      }
    }

    if (results.length === 0) {
      return [{ classification: 'EMPTY', detectedKeyId: null }];
    }
    return results;
  }

  return [
    { classification: 'UNREADABLE', detectedKeyId: null, details: 'Unsupported storage type' },
  ];
}
