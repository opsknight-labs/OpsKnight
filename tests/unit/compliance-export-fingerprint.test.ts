import { describe, expect, it } from 'vitest';
import {
  computeComplianceControlRegistryFingerprint,
  computeFrameworkMappingFingerprint,
} from '@/lib/compliance/fingerprint';

describe('compliance registry fingerprints', () => {
  it('computes deterministic control registry fingerprint', () => {
    const fp1 = computeComplianceControlRegistryFingerprint();
    const fp2 = computeComplianceControlRegistryFingerprint();
    expect(fp1).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fp1).toBe(fp2);
  });

  it('re-exports framework mapping fingerprint deterministically', () => {
    const fp1 = computeFrameworkMappingFingerprint();
    const fp2 = computeFrameworkMappingFingerprint();
    expect(fp1).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fp1).toBe(fp2);
  });
});
