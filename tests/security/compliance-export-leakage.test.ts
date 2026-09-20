import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildEvidencePackageZip } from '@/lib/compliance/export/zip';
import type { AuditSnapshotData } from '@/lib/compliance/export/snapshot';
import type { CollectedExportEvidence } from '@/lib/compliance/export/evidence';

const FORBIDDEN_SECRET_PATTERNS = [
  /passwordHash/i,
  /privateKey/i,
  /sessionSecret/i,
  /apiKey[_-]?secret/i,
  /BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/,
  /bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /cookie:\s*session=/i,
  /postgres:\/\/[^:]+:[^@]+@/i,
];

function scanForSensitiveContent(text: string): string[] {
  const findings: string[] = [];
  for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
    if (pattern.test(text)) {
      findings.push(pattern.source);
    }
  }
  return findings;
}

describe('compliance export secret leakage prevention', () => {
  const mockSnapshot: AuditSnapshotData = {
    snapshotAt: new Date().toISOString(),
    controls: [
      {
        controlId: 'SEC-ENC-001',
        title: 'Stored secret encryption',
        assessmentMode: 'RUNTIME',
        owner: 'MAINTAINER',
        resolvedCurrentState: 'IMPLEMENTED',
        summary: 'Envelope encryption operational with AES-256-GCM',
        evaluatedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        evaluator: { id: 'encryption.at-rest', version: '1.0.0' },
        evidenceCount: 1,
        frameworkMappings: [],
        gaps: [],
        implementation: 'Implementation metadata',
        evidencePaths: ['src/lib/encryption.ts'],
      },
    ],
    evaluations: [],
    frameworks: [],
    requirements: [],
    controlEvidenceCounts: new Map(),
  };

  const mockEvidence: CollectedExportEvidence = {
    evidenceRecords: [
      {
        id: 'evi_sample_sec',
        evaluationId: 'eval_sample_sec',
        controlId: 'SEC-ENC-001',
        type: 'CONFIG_SNAPSHOT',
        collectorId: 'encryption.at-rest',
        collectorVersion: '1.0.0',
        title: 'Secret Key Status',
        description: 'No raw secrets in evidence telemetry',
        resourceType: 'ENCRYPTION_KEY',
        resourceId: 'key_v3',
        observedAt: new Date().toISOString(),
        collectedAt: new Date().toISOString(),
        validUntil: null,
        metadata: {
          keyVersion: 'v3',
          algorithm: 'AES-256-GCM',
          active: true,
        },
        contentHash: 'sha256:abcd',
        integrityValid: true,
      },
    ],
    evidenceByControl: new Map(),
    totalCount: 1,
    integrityMismatchesCount: 0,
  };

  it('does not contain passwords, private keys, or tokens in any exported file', async () => {
    const pkg = await buildEvidencePackageZip({
      packageId: 'pkg_leakage_check',
      scope: { type: 'DEPLOYMENT' },
      evidenceSelection: { mode: 'SNAPSHOT' },
      snapshot: mockSnapshot,
      evidence: mockEvidence,
      userId: 'usr_audit_lead',
    });

    const zip = await JSZip.loadAsync(pkg.zipBuffer);
    const textFiles: string[] = [];

    zip.forEach((path, file) => {
      if (!file.dir) {
        textFiles.push(path);
      }
    });

    for (const filePath of textFiles) {
      const content = await zip.file(filePath)!.async('text');
      const leaked = scanForSensitiveContent(content);
      expect(
        leaked,
        `File ${filePath} contained sensitive pattern match: ${leaked.join(', ')}`
      ).toEqual([]);
    }
  });
});
