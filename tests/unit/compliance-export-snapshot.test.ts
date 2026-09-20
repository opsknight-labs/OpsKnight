import { describe, expect, it } from 'vitest';
import { buildAuditSnapshot } from '@/lib/compliance/export/snapshot';
import { resolveExportScope } from '@/lib/compliance/export/scope';
import { buildEvidencePackageZip } from '@/lib/compliance/export/zip';
import { generateFrameworksCsv } from '@/lib/compliance/export/csv';
import { APP_VERSION } from '@/lib/version';
import { EvidenceExportLimitExceededError } from '@/lib/compliance/export/evidence';
import type { PrismaClient } from '@prisma/client';
import JSZip from 'jszip';

describe('compliance export snapshot consistency and factual semantics (unit)', () => {
  const scope = resolveExportScope({
    type: 'CONTROLS',
    controlIds: ['SEC-ENC-001', 'PRIV-001'],
  });

  it('resolves un-evaluated runtime controls as UNVERIFIED (never ACTION_REQUIRED)', async () => {
    const mockPrisma = {
      complianceControlState: {
        findMany: async () => [],
      },
      complianceEvaluation: {
        findMany: async () => [],
        findFirst: async () => null,
      },
    } as unknown as PrismaClient;

    const snapshot = await buildAuditSnapshot(
      scope,
      new Date('2026-09-20T10:00:00.000Z'),
      mockPrisma
    );

    const runtimeControl = snapshot.controls.find(c => c.controlId === 'SEC-ENC-001');
    expect(runtimeControl).toBeDefined();
    expect(runtimeControl?.resolvedCurrentState).toBe('UNVERIFIED');
    expect(runtimeControl?.summary).toContain('Runtime control not yet evaluated');
  });

  it('normalizes repository catalog MISSING status to ACTION_REQUIRED', async () => {
    // Control PRIV-001 has catalogStatus: 'IMPLEMENTED', but let's test a scope with any control or verify normalization logic
    const allScope = resolveExportScope({ type: 'DEPLOYMENT' });
    const mockPrisma = {
      complianceControlState: {
        findMany: async () => [],
      },
      complianceEvaluation: {
        findMany: async () => [],
        findFirst: async () => null,
      },
    } as unknown as PrismaClient;

    const snapshot = await buildAuditSnapshot(
      allScope,
      new Date('2026-09-20T10:00:00.000Z'),
      mockPrisma
    );

    for (const c of snapshot.controls) {
      // Must never be 'MISSING'
      expect(c.resolvedCurrentState as string).not.toBe('MISSING');
      if (c.assessmentMode !== 'RUNTIME') {
        expect(['IMPLEMENTED', 'PARTIAL', 'ACTION_REQUIRED']).toContain(c.resolvedCurrentState);
      }
    }
  });

  it('ignores evaluations committed after snapshotAt and freezes point-in-time state', async () => {
    const cutoff = new Date('2026-09-20T10:00:00.000Z');
    const futureEvalDate = new Date('2026-09-20T10:00:02.000Z');

    // Current state has a future evaluation
    const mockPrisma = {
      complianceControlState: {
        findMany: async () => [
          {
            controlId: 'SEC-ENC-001',
            status: 'IMPLEMENTED',
            latestEvaluationId: 'eval_future',
            evaluatorId: 'encryption.at-rest',
            evaluatorVersion: '1.0.0',
            evaluatedAt: futureEvalDate,
            validUntil: new Date('2026-09-21T10:00:00.000Z'),
            summary: 'Future evaluation',
          },
        ],
      },
      complianceEvaluation: {
        findMany: async () => [],
        // Historical query returns null (no evaluation before cutoff)
        findFirst: async () => null,
      },
    } as unknown as PrismaClient;

    const snapshot = await buildAuditSnapshot(scope, cutoff, mockPrisma);
    const encControl = snapshot.controls.find(c => c.controlId === 'SEC-ENC-001');

    // Because the only evaluation happened AFTER cutoff, the state as of cutoff is UNVERIFIED!
    expect(encControl?.resolvedCurrentState).toBe('UNVERIFIED');
    expect(snapshot.evaluations).toHaveLength(0);
  });

  it('exports older evaluation when newer projection was evaluated after snapshotAt', async () => {
    const cutoff = new Date('2026-09-20T10:00:00.000Z');
    const pastEvalDate = new Date('2026-09-20T09:00:00.000Z');
    const futureEvalDate = new Date('2026-09-20T11:00:00.000Z');

    const mockPrisma = {
      complianceControlState: {
        findMany: async () => [
          {
            controlId: 'SEC-ENC-001',
            status: 'ACTION_REQUIRED',
            latestEvaluationId: 'eval_future_broken',
            evaluatorId: 'encryption.at-rest',
            evaluatorVersion: '1',
            evaluatedAt: futureEvalDate,
            validUntil: new Date('2026-09-21T10:00:00.000Z'),
            summary: 'Future broken state',
          },
        ],
      },
      complianceEvaluation: {
        findMany: async () => [],
        findFirst: async (args?: { where?: { controlId?: string } }) => {
          if (args?.where?.controlId === 'SEC-ENC-001') {
            return {
              id: 'eval_past_healthy',
              controlId: 'SEC-ENC-001',
              status: 'IMPLEMENTED',
              evaluatorId: 'encryption.at-rest',
              evaluatorVersion: '1',
              evaluatedAt: pastEvalDate,
              validUntil: new Date('2026-09-21T10:00:00.000Z'),
              summary: 'Past healthy state',
              findings: [],
            };
          }
          return null;
        },
      },
    } as unknown as PrismaClient;

    const snapshot = await buildAuditSnapshot(scope, cutoff, mockPrisma);
    const encControl = snapshot.controls.find(c => c.controlId === 'SEC-ENC-001');

    // Authoritatively resolved to the past healthy evaluation that was active at cutoff
    expect(encControl?.resolvedCurrentState).toBe('IMPLEMENTED');
    expect(encControl?.summary).toBe('Past healthy state');
    expect(snapshot.evaluations).toHaveLength(1);
    expect(snapshot.evaluations[0].evaluationId).toBe('eval_past_healthy');
  });

  it('dynamically resolves DPDP requirement lifecycles before and after 2027-05-13', async () => {
    const dpdpScope = resolveExportScope({ type: 'FRAMEWORK', framework: 'DPDP' });
    const mockPrisma = {
      complianceControlState: { findMany: async () => [] },
      complianceEvaluation: { findMany: async () => [], findFirst: async () => null },
    } as unknown as PrismaClient;

    // 1. Before effective date: 2026-09-20
    const snapshotBefore = await buildAuditSnapshot(
      dpdpScope,
      new Date('2026-09-20T10:00:00.000Z'),
      mockPrisma
    );
    const dpdpReqBefore = snapshotBefore.requirements.find(
      r => r.requirementId === 'DPDP-SECURITY-SAFEGUARDS'
    );
    expect(dpdpReqBefore?.lifecycle).toBe('FUTURE');

    // 2. After effective date: 2027-06-01
    const snapshotAfter = await buildAuditSnapshot(
      dpdpScope,
      new Date('2027-06-01T10:00:00.000Z'),
      mockPrisma
    );
    const dpdpReqAfter = snapshotAfter.requirements.find(
      r => r.requirementId === 'DPDP-SECURITY-SAFEGUARDS'
    );
    expect(dpdpReqAfter?.lifecycle).toBe('ACTIVE');
  });

  it('dynamically resolves CRA Annex I requirement lifecycles before and after 2027-12-11', async () => {
    const craScope = resolveExportScope({ type: 'FRAMEWORK', framework: 'CRA' });
    const mockPrisma = {
      complianceControlState: { findMany: async () => [] },
      complianceEvaluation: { findMany: async () => [], findFirst: async () => null },
    } as unknown as PrismaClient;

    // 1. Before 11 Dec 2027
    const snapshotBefore = await buildAuditSnapshot(
      craScope,
      new Date('2026-09-20T10:00:00.000Z'),
      mockPrisma
    );
    const craReqBefore = snapshotBefore.requirements.find(
      r => r.requirementId === 'CRA-ANNEX-I-SECURITY'
    );
    expect(craReqBefore?.lifecycle).toBe('FUTURE');

    // 2. After 11 Dec 2027
    const snapshotAfter = await buildAuditSnapshot(
      craScope,
      new Date('2027-12-15T10:00:00.000Z'),
      mockPrisma
    );
    const craReqAfter = snapshotAfter.requirements.find(
      r => r.requirementId === 'CRA-ANNEX-I-SECURITY'
    );
    expect(craReqAfter?.lifecycle).toBe('ACTIVE');
  });

  it('exports real FrameworkControlMapping fields (relationship, evidenceExpectation, rationale, notes) to CSV', async () => {
    const dpdpScope = resolveExportScope({ type: 'FRAMEWORK', framework: 'DPDP' });
    const mockPrisma = {
      complianceControlState: { findMany: async () => [] },
      complianceEvaluation: { findMany: async () => [], findFirst: async () => null },
    } as unknown as PrismaClient;
    const snapshot = await buildAuditSnapshot(dpdpScope, new Date(), mockPrisma);
    const csv = generateFrameworksCsv(snapshot.requirements, snapshot.mappings);

    expect(csv).toContain(
      'framework,requirement_id,reference,lifecycle,control_id,relationship,evidence_expectation,rationale,notes'
    );
    // Ensure real relationship and evidence expectations appear
    expect(csv).toMatch(/TECHNICAL_EVIDENCE|PROCESS_SUPPORT|OPERATOR_DEPENDENCY/);
    expect(csv).toMatch(/RUNTIME|REPOSITORY|OPERATOR/);
  });

  it('sets package product version to actual application version and verifies sha256sums is protected in manifest', async () => {
    const mockSnapshot = {
      snapshotAt: new Date().toISOString(),
      controls: [],
      evaluations: [],
      frameworks: [],
      requirements: [],
      mappings: [],
      controlEvidenceCounts: new Map(),
    };

    const pkg = await buildEvidencePackageZip({
      packageId: 'pkg_version_test',
      scope: { type: 'DEPLOYMENT' },
      evidenceSelection: { mode: 'SNAPSHOT' },
      snapshot: mockSnapshot,
      evidence: {
        evidenceRecords: [],
        evidenceByControl: new Map(),
        totalCount: 0,
        integrityMismatchesCount: 0,
      },
      userId: 'usr_test',
    });

    // Authoritative version must match APP_VERSION (1.4.0)
    expect(pkg.manifestResult.manifest.product.version).toBe(APP_VERSION);
    expect(pkg.manifestResult.manifest.product.name).toBe('OpsKnight');
    expect(pkg.manifestResult.manifest.product.buildId).toBeDefined();

    // Verify integrity/sha256sums.txt is listed in manifest.files
    expect(pkg.manifestResult.manifest.files.some(f => f.path === 'integrity/sha256sums.txt')).toBe(
      true
    );

    const zip = await JSZip.loadAsync(pkg.zipBuffer);
    expect(zip.file('integrity/sha256sums.txt')).toBeDefined();
    expect(zip.file('summary/mappings.json')).toBeDefined();
  });

  it('fails explicitly with EvidenceExportLimitExceededError when uncompressed package exceeds byte budget', async () => {
    const hugeBuffer = Buffer.alloc(51 * 1024 * 1024); // 51 MB > 50 MB limit

    const mockSnapshot = {
      snapshotAt: new Date().toISOString(),
      controls: [
        {
          controlId: 'SEC-ENC-001',
          title: 'Stored secret encryption',
          assessmentMode: 'RUNTIME' as const,
          owner: 'MAINTAINER' as const,
          resolvedCurrentState: 'IMPLEMENTED' as const,
          summary: 'Envelope encryption active',
          evidenceCount: 1,
          frameworkMappings: [],
          gaps: [],
          implementation: 'crypto.ts',
          evidencePaths: [],
        },
      ],
      evaluations: [],
      frameworks: [],
      requirements: [],
      mappings: [],
      controlEvidenceCounts: new Map(),
    };

    const hugeRecord = {
      id: 'ev_huge',
      evaluationId: 'eval_1',
      controlId: 'SEC-ENC-001',
      type: 'CONFIGURATION_SNAPSHOT',
      collectorId: 'encryption.at-rest',
      collectorVersion: '1.0.0',
      title: 'Huge config payload',
      description: null,
      resourceType: null,
      resourceId: null,
      observedAt: new Date().toISOString(),
      collectedAt: new Date().toISOString(),
      validUntil: null,
      metadata: { dump: hugeBuffer.toString('base64') },
      contentHash: 'sha256:abcd',
      integrityValid: true,
    };

    const mockHugeEvidence = {
      evidenceRecords: [hugeRecord],
      evidenceByControl: new Map([['SEC-ENC-001', [hugeRecord]]]),
      totalCount: 1,
      integrityMismatchesCount: 0,
    };

    await expect(
      buildEvidencePackageZip({
        packageId: 'pkg_oversized',
        scope: { type: 'DEPLOYMENT' },
        evidenceSelection: { mode: 'SNAPSHOT' },
        snapshot: mockSnapshot,
        evidence: mockHugeEvidence,
        userId: 'usr_test',
      })
    ).rejects.toThrow(EvidenceExportLimitExceededError);
  });
});
