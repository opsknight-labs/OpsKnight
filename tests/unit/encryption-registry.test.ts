import { describe, it, expect } from 'vitest';
import {
  ENCRYPTION_TARGETS,
  computeRegistryFingerprint,
  getTargetById,
} from '@/lib/encryption/registry';

describe('Encryption Registry Unit Tests', () => {
  it('getTargetById returns target when present', () => {
    const oidc = getTargetById('oidc.client-secret');
    expect(oidc).toBeDefined();
    expect(oidc?.model).toBe('OidcConfig');
    expect(oidc?.field).toBe('clientSecret');

    const missing = getTargetById('non.existent');
    expect(missing).toBeUndefined();
  });

  it('registry targets have distinct and valid target IDs', () => {
    const ids = ENCRYPTION_TARGETS.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    for (const id of ids) {
      const parts = id.split('.');
      expect(parts.length).toBeGreaterThanOrEqual(2);
      for (const part of parts) {
        expect(part).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });

  it('fingerprint changes if a target definition is modified', () => {
    const originalFp = computeRegistryFingerprint(ENCRYPTION_TARGETS);

    const modifiedTargets = ENCRYPTION_TARGETS.map(t =>
      t.id === 'oidc.client-secret'
        ? { ...t, plaintextLegacyAllowed: !t.plaintextLegacyAllowed }
        : t
    );

    const modifiedFp = computeRegistryFingerprint(modifiedTargets);
    expect(modifiedFp).not.toBe(originalFp);
  });
});
