import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildEvidencePackageZip } from '@/lib/compliance/export/zip';
import type { AuditSnapshotData } from '@/lib/compliance/export/snapshot';
import type { CollectedExportEvidence } from '@/lib/compliance/export/evidence';

describe('compliance export non-certification language boundary', () => {
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
        evidenceCount: 0,
        frameworkMappings: [],
        gaps: [],
        implementation: 'Envelope encryption',
        evidencePaths: [],
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
        mappedControls: [{ controlId: 'SEC-ENC-001', relationship: 'TECHNICAL_EVIDENCE' }],
        operatorAssessmentRequired: true,
      },
    ],
    controlEvidenceCounts: new Map(),
  };

  const mockEvidence: CollectedExportEvidence = {
    evidenceRecords: [],
    evidenceByControl: new Map(),
    totalCount: 0,
    integrityMismatchesCount: 0,
  };

  it('never outputs certification or compliance percentages in manifest or files', async () => {
    const pkg = await buildEvidencePackageZip({
      packageId: 'pkg_lang_test',
      scope: { type: 'FRAMEWORK', framework: 'GDPR' },
      evidenceSelection: { mode: 'SNAPSHOT' },
      snapshot: mockSnapshot,
      evidence: mockEvidence,
      userId: 'usr_audit_lead',
    });

    const manifestObj = pkg.manifestResult.manifest as unknown as Record<string, unknown>;

    expect(manifestObj.readinessScore).toBeUndefined();
    expect(manifestObj.complianceScore).toBeUndefined();
    expect(manifestObj.compliancePercentage).toBeUndefined();
    expect(manifestObj.certified).toBeUndefined();
    expect(manifestObj.status).toBeUndefined();

    const zip = await JSZip.loadAsync(pkg.zipBuffer);
    const readmeContent = await zip.file('README.md')!.async('text');

    expect(readmeContent).toContain('do not constitute legal advice, certification, audit opinion');
    expect(readmeContent).toContain('OpsKnight does not certify');

    // Requirements must never have status 'PASSED' or 'COMPLIANT'
    const reqsContent = await zip.file('frameworks/GDPR/requirements.json')!.async('text');
    const reqs = JSON.parse(reqsContent);
    for (const r of reqs) {
      expect(r.status).toBeUndefined();
      expect(r.requirementStatus).toBeUndefined();
      expect(r.passed).toBeUndefined();
      expect(r.compliant).toBeUndefined();
    }
  });
});
