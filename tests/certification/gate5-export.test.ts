import { describe, expect, it } from 'vitest';
import { buildEvidencePackageZip } from '@/lib/compliance/export/zip';
import type { AuditSnapshotData } from '@/lib/compliance/export/snapshot';
import type { CollectedExportEvidence } from '@/lib/compliance/export/evidence';
import { verifyAuditPackageZip } from './helpers';

describe('Gate 5: Audit Export Package Certification', () => {
  const mockSnapshot: AuditSnapshotData = {
    snapshotAt: new Date().toISOString(),
    controls: [
      {
        controlId: 'CERT-AUDIT-01',
        title: 'Cryptographic Audit Trails',
        assessmentMode: 'RUNTIME',
        owner: 'OPERATOR',
        resolvedCurrentState: 'IMPLEMENTED',
        summary: 'All audit events signed',
        evaluatedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        evaluator: { id: 'audit.trail', version: '1.0.0' },
        evidenceCount: 1,
        frameworkMappings: [
          {
            framework: 'GDPR',
            requirementId: 'GDPR-ART-32',
            reference: 'Article 32',
            lifecycle: 'ACTIVE',
            relationship: 'TECHNICAL_EVIDENCE',
            evidenceExpectation: 'Audit logs signed',
            rationale: 'Article 32 security measures',
          },
        ],
        gaps: [],
        implementation: 'HMAC SHA-256',
        evidencePaths: ['evidence/CERT-AUDIT-01/eval-summary.json'],
      },
    ],
    evaluations: [],
    frameworks: [
      {
        id: 'GDPR',
        title: 'General Data Protection Regulation',
        version: 'Regulation (EU) 2016/679',
        jurisdiction: 'European Union',
        frameworkType: 'REGULATION',
        authoritativeSource: 'EUR-Lex',
        sourceUrl: 'https://eur-lex.europa.eu',
        notes: null,
      },
    ],
    requirements: [
      {
        requirementId: 'GDPR-ART-32',
        framework: 'GDPR',
        reference: 'Article 32',
        title: 'Security of processing',
        summary: 'Technical and organizational measures',
        sourceUrl: 'https://eur-lex.europa.eu',
        lifecycle: 'ACTIVE',
        applicability: 'SHARED',
        effectiveFrom: '2018-05-25',
        effectiveUntil: null,
        mappedControls: [{ controlId: 'CERT-AUDIT-01', relationship: 'TECHNICAL_EVIDENCE' }],
        operatorAssessmentRequired: true,
      },
    ],
    mappings: [],
    controlEvidenceCounts: new Map([['CERT-AUDIT-01', 1]]),
  };

  const mockEvidence: CollectedExportEvidence = {
    evidenceRecords: [
      {
        id: 'ev-cert-1',
        evaluationId: 'eval-cert-1',
        controlId: 'CERT-AUDIT-01',
        type: 'CONFIGURATION_SNAPSHOT',
        collectorId: 'cert-collector',
        collectorVersion: '1.0.0',
        title: 'Audit signing config',
        description: 'Audit signing configuration snapshot',
        resourceType: 'SERVICE',
        resourceId: 'audit-signer',
        observedAt: new Date().toISOString(),
        collectedAt: new Date().toISOString(),
        validUntil: null,
        metadata: { signing: 'enabled', keyId: 'k-1' },
        contentHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        integrityValid: true,
      },
    ],
    evidenceByControl: new Map(),
    totalCount: 1,
    integrityMismatchesCount: 0,
  };

  it('builds an immutable audit package and certifies all cryptographic checksums and disclaimers', async () => {
    const pkg = await buildEvidencePackageZip({
      packageId: 'cert_pkg_2026',
      scope: { type: 'FRAMEWORK', framework: 'GDPR' },
      evidenceSelection: { mode: 'SNAPSHOT' },
      snapshot: mockSnapshot,
      evidence: mockEvidence,
      userId: 'cert-auditor-user',
    });

    expect(pkg.zipBuffer).toBeDefined();
    expect(pkg.manifestResult.manifest.packageId).toBe('cert_pkg_2026');

    // Programmatically verify ZIP structure, checksums, and manifest
    const verification = await verifyAuditPackageZip(pkg.zipBuffer);
    expect(verification.valid).toBe(true);
    expect(verification.errors).toHaveLength(0);
    expect(verification.fileCount).toBeGreaterThanOrEqual(4);
  });
});
