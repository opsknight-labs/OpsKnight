import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildEvidencePackageZip } from '@/lib/compliance/export/zip';
import { verifyEvidencePackageManifest } from '@/lib/compliance/export/verify';
import type { AuditSnapshotData } from '@/lib/compliance/export/snapshot';
import type { CollectedExportEvidence } from '@/lib/compliance/export/evidence';

describe('verifyEvidencePackageManifest', () => {
  const mockSnapshot: AuditSnapshotData = {
    snapshotAt: new Date().toISOString(),
    controls: [
      {
        controlId: 'SEC-ENC-001',
        title: 'Stored secret encryption',
        assessmentMode: 'RUNTIME',
        owner: 'MAINTAINER',
        resolvedCurrentState: 'IMPLEMENTED',
        summary: 'Encryption operational',
        evaluatedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        evaluator: { id: 'encryption.at-rest', version: '1.0.0' },
        evidenceCount: 1,
        frameworkMappings: [],
        gaps: [],
        implementation: 'Implementation details',
        evidencePaths: ['src/lib/encryption.ts'],
      },
    ],
    evaluations: [
      {
        evaluationId: 'eval_mock_1',
        controlId: 'SEC-ENC-001',
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1.0.0',
        status: 'IMPLEMENTED',
        summary: 'Evaluated ok',
        evaluatedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        findings: [],
      },
    ],
    frameworks: [],
    requirements: [],
    controlEvidenceCounts: new Map([['SEC-ENC-001', 1]]),
  };

  const mockEvidence: CollectedExportEvidence = {
    evidenceRecords: [
      {
        id: 'evi_mock_1',
        evaluationId: 'eval_mock_1',
        controlId: 'SEC-ENC-001',
        type: 'CONFIG_SNAPSHOT',
        collectorId: 'encryption.at-rest',
        collectorVersion: '1.0.0',
        title: 'Encryption keys verified',
        description: 'Mock evidence item',
        resourceType: 'ENCRYPTION_KEY',
        resourceId: 'key_v3',
        observedAt: new Date().toISOString(),
        collectedAt: new Date().toISOString(),
        validUntil: null,
        metadata: { algorithm: 'AES-256-GCM' },
        contentHash: 'sha256:abcd1234',
        integrityValid: true,
      },
    ],
    evidenceByControl: new Map([
      [
        'SEC-ENC-001',
        [
          {
            id: 'evi_mock_1',
            evaluationId: 'eval_mock_1',
            controlId: 'SEC-ENC-001',
            type: 'CONFIG_SNAPSHOT',
            collectorId: 'encryption.at-rest',
            collectorVersion: '1.0.0',
            title: 'Encryption keys verified',
            description: 'Mock evidence item',
            resourceType: 'ENCRYPTION_KEY',
            resourceId: 'key_v3',
            observedAt: new Date().toISOString(),
            collectedAt: new Date().toISOString(),
            validUntil: null,
            metadata: { algorithm: 'AES-256-GCM' },
            contentHash: 'sha256:abcd1234',
            integrityValid: true,
          },
        ],
      ],
    ]),
    totalCount: 1,
    integrityMismatchesCount: 0,
  };

  it('successfully verifies an untampered evidence package', async () => {
    const pkg = await buildEvidencePackageZip({
      packageId: 'pkg_test_1',
      scope: { type: 'CONTROLS', controlIds: ['SEC-ENC-001'] },
      evidenceSelection: { mode: 'SNAPSHOT' },
      snapshot: mockSnapshot,
      evidence: mockEvidence,
      userId: 'user_tester',
    });

    const result = await verifyEvidencePackageManifest(pkg.zipBuffer);
    expect(result.valid).toBe(true);
    expect(result.manifestValid).toBe(true);
    expect(result.entriesTotal).toBeGreaterThan(3);
    expect(result.entriesVerified).toBe(result.entriesTotal);
    expect(result.mismatches).toHaveLength(0);
  });

  it('detects tampering when an evidence JSON file is modified', async () => {
    const pkg = await buildEvidencePackageZip({
      packageId: 'pkg_test_tamper_ev',
      scope: { type: 'CONTROLS', controlIds: ['SEC-ENC-001'] },
      evidenceSelection: { mode: 'SNAPSHOT' },
      snapshot: mockSnapshot,
      evidence: mockEvidence,
      userId: 'user_tester',
    });

    const zip = await JSZip.loadAsync(pkg.zipBuffer);
    const evPath = 'controls/SEC-ENC-001/evidence/evi_mock_1.json';
    zip.file(evPath, JSON.stringify({ tampered: true }));

    const tamperedBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await verifyEvidencePackageManifest(tamperedBuffer);

    expect(result.valid).toBe(false);
    expect(result.mismatches.some(m => m.path === evPath)).toBe(true);
  });

  it('detects tampering when manifest.json is modified', async () => {
    const pkg = await buildEvidencePackageZip({
      packageId: 'pkg_test_tamper_manifest',
      scope: { type: 'CONTROLS', controlIds: ['SEC-ENC-001'] },
      evidenceSelection: { mode: 'SNAPSHOT' },
      snapshot: mockSnapshot,
      evidence: mockEvidence,
      userId: 'user_tester',
    });

    const zip = await JSZip.loadAsync(pkg.zipBuffer);
    const originalManifest = await zip.file('manifest.json')!.async('text');
    const parsed = JSON.parse(originalManifest);
    parsed.product.version = '9.9.9-fake';
    zip.file('manifest.json', JSON.stringify(parsed, null, 2));

    const tamperedBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await verifyEvidencePackageManifest(tamperedBuffer);

    expect(result.valid).toBe(false);
    expect(result.manifestValid).toBe(false);
    expect(result.mismatches.some(m => m.path === 'manifest.json')).toBe(true);
  });

  it('detects missing files when an entry is removed from the archive', async () => {
    const pkg = await buildEvidencePackageZip({
      packageId: 'pkg_test_delete',
      scope: { type: 'CONTROLS', controlIds: ['SEC-ENC-001'] },
      evidenceSelection: { mode: 'SNAPSHOT' },
      snapshot: mockSnapshot,
      evidence: mockEvidence,
      userId: 'user_tester',
    });

    const zip = await JSZip.loadAsync(pkg.zipBuffer);
    const target = 'controls/SEC-ENC-001/control.json';
    zip.remove(target);

    const tamperedBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await verifyEvidencePackageManifest(tamperedBuffer);

    expect(result.valid).toBe(false);
    expect(result.mismatches.some(m => m.path === target && m.reason === 'MISSING')).toBe(true);
  });

  it('detects unlisted files injected into the archive', async () => {
    const pkg = await buildEvidencePackageZip({
      packageId: 'pkg_test_inject',
      scope: { type: 'CONTROLS', controlIds: ['SEC-ENC-001'] },
      evidenceSelection: { mode: 'SNAPSHOT' },
      snapshot: mockSnapshot,
      evidence: mockEvidence,
      userId: 'user_tester',
    });

    const zip = await JSZip.loadAsync(pkg.zipBuffer);
    zip.file('malicious_script.sh', 'rm -rf /');

    const tamperedBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await verifyEvidencePackageManifest(tamperedBuffer);

    expect(result.valid).toBe(false);
    expect(
      result.mismatches.some(m => m.path === 'malicious_script.sh' && m.reason === 'UNLISTED_FILE')
    ).toBe(true);
  });
});
