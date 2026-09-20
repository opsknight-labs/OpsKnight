import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildEvidencePackageManifest } from '@/lib/compliance/export/manifest';

describe('buildEvidencePackageManifest', () => {
  const params = {
    packageId: 'pkg_unit_1',
    generatedAt: '2026-09-20T10:00:00.000Z',
    snapshotAt: '2026-09-20T10:00:00.000Z',
    scope: { type: 'DEPLOYMENT' as const },
    evidenceSelection: { mode: 'SNAPSHOT' as const },
    productVersion: '2.0.0',
    controlRegistryFingerprint:
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    frameworkMappingFingerprint:
      'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    frameworks: [
      {
        id: 'GDPR' as const,
        title: 'General Data Protection Regulation',
        version: 'Regulation (EU) 2016/679',
        jurisdiction: 'European Union',
        frameworkType: 'REGULATION',
        authoritativeSource: 'EUR-Lex',
        sourceUrl: 'https://eur-lex.europa.eu',
        notes: null,
      },
    ],
    counts: {
      controls: 5,
      requirements: 10,
      evidence: 20,
      integrityMismatches: 0,
    },
    files: [
      {
        path: 'summary/controls.csv',
        mediaType: 'text/csv',
        sizeBytes: 120,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        path: 'README.md',
        mediaType: 'text/markdown',
        sizeBytes: 300,
        sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
      },
    ],
    userId: 'usr_audit_agent',
  };

  it('builds canonical manifest and deterministic SHA-256 hash', () => {
    const res1 = buildEvidencePackageManifest(params);
    const res2 = buildEvidencePackageManifest(params);

    expect(res1.manifest.schemaVersion).toBe('1');
    expect(res1.manifest.packageId).toBe('pkg_unit_1');
    expect(res1.manifestSha256).toBe(res2.manifestSha256);
    expect(res1.manifestSha256Content).toBe(`${res1.manifestSha256}  manifest.json\n`);

    // Verify sha256 matches actual buffer
    const hash = createHash('sha256').update(res1.manifestBuffer).digest('hex');
    expect(res1.manifestSha256).toBe(hash);
  });

  it('sorts file entries alphabetically in manifest', () => {
    const res = buildEvidencePackageManifest(params);

    expect(res.manifest.files[0].path).toBe('README.md');
    expect(res.manifest.files[1].path).toBe('summary/controls.csv');
  });
});
