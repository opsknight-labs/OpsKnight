// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma } from '../helpers/test-db';
import {
  exportComplianceEvidencePackage,
  previewComplianceEvidencePackage,
  verifyEvidencePackageManifest,
} from '@/lib/compliance/export';
import { computeEvidenceContentHash } from '@/lib/compliance/evidence/hash';
import JSZip from 'jszip';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('verifiable compliance evidence package export (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('exports deployment package and independently verifies SHA-256 integrity manifest', async () => {
    // 1. Seed an evaluation and valid durable evidence
    const evaluation = await testPrisma.complianceEvaluation.create({
      data: {
        batchId: 'batch_exp_1',
        controlId: 'SEC-ENC-001',
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1.0.0',
        status: 'IMPLEMENTED',
        trigger: 'MANUAL',
        evaluatedAt: new Date(),
        validUntil: new Date(Date.now() + 86400000),
        summary: 'Stored secrets use AES-256-GCM v3 envelope encryption',
        findings: [],
      },
    });

    await testPrisma.complianceControlState.create({
      data: {
        controlId: 'SEC-ENC-001',
        status: 'IMPLEMENTED',
        latestEvaluationId: evaluation.id,
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1.0.0',
        evaluatedAt: evaluation.evaluatedAt,
        validUntil: evaluation.validUntil,
        summary: evaluation.summary,
      },
    });

    const now = new Date();
    const draft = {
      type: 'CONFIGURATION_SNAPSHOT' as const,
      collectorId: 'encryption.at-rest',
      collectorVersion: '1.0.0',
      title: 'Active encryption key rotation state',
      description: 'v3 active key verified',
      resourceType: 'ENCRYPTION_KEY',
      resourceId: 'key_v3',
      observedAt: now,
      metadata: { activeVersion: 3, algorithm: 'AES-256-GCM' },
    };

    const validHash = computeEvidenceContentHash({
      controlId: 'SEC-ENC-001',
      evaluationId: evaluation.id,
      draft,
      collectedAt: now,
    });

    await testPrisma.complianceEvidence.create({
      data: {
        controlId: 'SEC-ENC-001',
        evaluationId: evaluation.id,
        type: draft.type,
        collectorId: draft.collectorId,
        collectorVersion: draft.collectorVersion,
        title: draft.title,
        description: draft.description,
        resourceType: draft.resourceType,
        resourceId: draft.resourceId,
        observedAt: draft.observedAt,
        collectedAt: now,
        contentHash: validHash,
        metadata: draft.metadata,
      },
    });

    // 2. Generate deployment package
    const pkg = await exportComplianceEvidencePackage({
      scope: { type: 'DEPLOYMENT' },
      evidenceSelection: { mode: 'SNAPSHOT' },
      userId: 'usr_lead_auditor',
      prisma: testPrisma,
    });

    expect(pkg.zipBuffer).toBeDefined();
    expect(pkg.zipBuffer.byteLength).toBeGreaterThan(1000);
    expect(pkg.filename).toMatch(/^opsknight-evidence-package-deployment-.*\.zip$/);

    // 3. Verify manifest and all file entries with independent verifier
    const verification = await verifyEvidencePackageManifest(pkg.zipBuffer);
    expect(verification.valid).toBe(true);
    expect(verification.manifestValid).toBe(true);
    expect(verification.mismatches).toHaveLength(0);
    expect(verification.entriesTotal).toBeGreaterThan(10);

    // 4. Verify presence and structure of exported files
    const zip = await JSZip.loadAsync(pkg.zipBuffer);
    expect(zip.file('manifest.json')).not.toBeNull();
    expect(zip.file('manifest.sha256')).not.toBeNull();
    expect(zip.file('README.md')).not.toBeNull();
    expect(zip.file('integrity/sha256sums.txt')).not.toBeNull();
    expect(zip.file('summary/controls.csv')).not.toBeNull();
    expect(zip.file('summary/frameworks.csv')).not.toBeNull();
    expect(zip.file('summary/evidence-index.csv')).not.toBeNull();
    expect(zip.file('controls/SEC-ENC-001/control.json')).not.toBeNull();
    expect(zip.file('controls/SEC-ENC-001/evaluation.json')).not.toBeNull();

    // 5. Verify non-certification language in README
    const readme = await zip.file('README.md')!.async('text');
    expect(readme).toContain('do not constitute legal advice, certification, audit opinion');
    expect(readme).toContain('OpsKnight does not certify');
  });

  it('preserves and flags evidence records with SHA-256 integrity mismatches without dropping them', async () => {
    const evaluation = await testPrisma.complianceEvaluation.create({
      data: {
        batchId: 'batch_exp_mismatch',
        controlId: 'SEC-ENC-001',
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1.0.0',
        status: 'IMPLEMENTED',
        trigger: 'MANUAL',
        evaluatedAt: new Date(),
        summary: 'Evaluation completed',
        findings: [],
      },
    });

    await testPrisma.complianceControlState.create({
      data: {
        controlId: 'SEC-ENC-001',
        status: 'IMPLEMENTED',
        latestEvaluationId: evaluation.id,
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1.0.0',
        evaluatedAt: evaluation.evaluatedAt,
        summary: evaluation.summary,
      },
    });

    // Create an intentionally tampered evidence record (wrong contentHash)
    const now = new Date();
    await testPrisma.complianceEvidence.create({
      data: {
        controlId: 'SEC-ENC-001',
        evaluationId: evaluation.id,
        type: 'CONFIGURATION_SNAPSHOT',
        collectorId: 'encryption.at-rest',
        collectorVersion: '1.0.0',
        title: 'Tampered evidence record',
        observedAt: now,
        collectedAt: now,
        contentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        metadata: { forged: true },
      },
    });

    const pkg = await exportComplianceEvidencePackage({
      scope: { type: 'CONTROLS', controlIds: ['SEC-ENC-001'] },
      evidenceSelection: { mode: 'SNAPSHOT' },
      userId: 'usr_auditor',
      prisma: testPrisma,
    });

    expect(pkg.counts.integrityMismatches).toBe(1);

    const zip = await JSZip.loadAsync(pkg.zipBuffer);
    const evidenceIndex = await zip.file('summary/evidence-index.csv')!.async('text');
    expect(evidenceIndex).toContain('MISMATCH');

    // Archive integrity verification must still succeed (the archive accurately records the mismatch)
    const verification = await verifyEvidencePackageManifest(pkg.zipBuffer);
    expect(verification.valid).toBe(true);
    expect(verification.warnings.some(w => w.includes('failed runtime SHA-256'))).toBe(true);
  });

  it('respects snapshot cutoff boundary and historical date window', async () => {
    const cutoff = new Date('2026-09-20T10:00:00.000Z');

    const evaluation = await testPrisma.complianceEvaluation.create({
      data: {
        batchId: 'batch_cutoff',
        controlId: 'SEC-ENC-001',
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1.0.0',
        status: 'IMPLEMENTED',
        trigger: 'MANUAL',
        evaluatedAt: new Date('2026-09-20T09:00:00.000Z'),
        summary: 'Evaluation completed',
        findings: [],
      },
    });

    await testPrisma.complianceControlState.create({
      data: {
        controlId: 'SEC-ENC-001',
        status: 'IMPLEMENTED',
        latestEvaluationId: evaluation.id,
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1.0.0',
        evaluatedAt: evaluation.evaluatedAt,
        summary: evaluation.summary,
      },
    });

    // Evidence before cutoff
    await testPrisma.complianceEvidence.create({
      data: {
        controlId: 'SEC-ENC-001',
        evaluationId: evaluation.id,
        type: 'CONFIGURATION_SNAPSHOT',
        collectorId: 'encryption.at-rest',
        collectorVersion: '1.0.0',
        title: 'Before cutoff',
        observedAt: new Date('2026-09-20T09:30:00.000Z'),
        collectedAt: new Date('2026-09-20T09:30:00.000Z'),
        contentHash: 'sha256:1111',
        metadata: {},
      },
    });

    // Evidence after cutoff
    await testPrisma.complianceEvidence.create({
      data: {
        controlId: 'SEC-ENC-001',
        evaluationId: evaluation.id,
        type: 'CONFIGURATION_SNAPSHOT',
        collectorId: 'encryption.at-rest',
        collectorVersion: '1.0.0',
        title: 'After cutoff',
        observedAt: new Date('2026-09-20T10:30:00.000Z'),
        collectedAt: new Date('2026-09-20T10:30:00.000Z'),
        contentHash: 'sha256:2222',
        metadata: {},
      },
    });

    const pkg = await exportComplianceEvidencePackage({
      scope: { type: 'CONTROLS', controlIds: ['SEC-ENC-001'] },
      evidenceSelection: {
        mode: 'HISTORICAL',
        from: '2026-09-20T09:00:00.000Z',
        to: '2026-09-20T11:00:00.000Z',
      },
      now: cutoff,
      userId: 'usr_auditor',
      prisma: testPrisma,
    });

    // Only the record collectedAt <= cutoff must be exported
    expect(pkg.counts.evidence).toBe(1);
    const zip = await JSZip.loadAsync(pkg.zipBuffer);
    const index = await zip.file('summary/evidence-index.csv')!.async('text');
    expect(index).not.toContain('After cutoff');
  });

  it('provides quick counts via preview coordinator without generating full archive', async () => {
    const preview = await previewComplianceEvidencePackage({
      scope: { type: 'FRAMEWORK', framework: 'GDPR' },
      evidenceSelection: { mode: 'SNAPSHOT' },
      prisma: testPrisma,
    });

    expect(preview.scope.type).toBe('FRAMEWORK');
    expect(preview.counts.requirements).toBeGreaterThan(0);
    expect(preview.counts.controls).toBeGreaterThan(0);
    expect(preview.estimatedSizeBytes).toBeGreaterThan(0);
  });

  it('never borrows evidence from older evaluations when latest evaluation has zero evidence', async () => {
    // 1. Old evaluation with supporting evidence
    const evalOld = await testPrisma.complianceEvaluation.create({
      data: {
        batchId: 'batch_old',
        controlId: 'SEC-ENC-001',
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1.0.0',
        status: 'IMPLEMENTED',
        trigger: 'MANUAL',
        evaluatedAt: new Date('2026-09-20T08:00:00.000Z'),
        summary: 'Old evaluation',
        findings: [],
      },
    });

    await testPrisma.complianceEvidence.create({
      data: {
        controlId: 'SEC-ENC-001',
        evaluationId: evalOld.id,
        type: 'CONFIGURATION_SNAPSHOT',
        collectorId: 'encryption.at-rest',
        collectorVersion: '1.0.0',
        title: 'Old evaluation evidence',
        observedAt: new Date('2026-09-20T08:00:00.000Z'),
        collectedAt: new Date('2026-09-20T08:00:00.000Z'),
        contentHash: 'sha256:old-hash',
        metadata: {},
      },
    });

    // 2. New evaluation with ZERO supporting evidence
    const evalNew = await testPrisma.complianceEvaluation.create({
      data: {
        batchId: 'batch_new',
        controlId: 'SEC-ENC-001',
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1.0.0',
        status: 'IMPLEMENTED',
        trigger: 'SCHEDULED',
        evaluatedAt: new Date('2026-09-20T09:00:00.000Z'),
        summary: 'New evaluation with no evidence',
        findings: [],
      },
    });

    await testPrisma.complianceControlState.create({
      data: {
        controlId: 'SEC-ENC-001',
        status: 'IMPLEMENTED',
        latestEvaluationId: evalNew.id,
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1.0.0',
        evaluatedAt: evalNew.evaluatedAt,
        summary: evalNew.summary,
      },
    });

    // 3. Export snapshot
    const pkg = await exportComplianceEvidencePackage({
      scope: { type: 'CONTROLS', controlIds: ['SEC-ENC-001'] },
      evidenceSelection: { mode: 'SNAPSHOT' },
      userId: 'usr_auditor',
      prisma: testPrisma,
    });

    // Must NOT borrow evidence from evalOld!
    expect(pkg.counts.evidence).toBe(0);
    const zip = await JSZip.loadAsync(pkg.zipBuffer);
    const indexCsv = await zip.file('summary/evidence-index.csv')!.async('text');
    expect(indexCsv).not.toContain('Old evaluation evidence');
  });

  it('guarantees REPEATABLE READ snapshot isolation against concurrently committing transactions', async () => {
    // 1. Seed baseline healthy evaluation
    const baseEval = await testPrisma.complianceEvaluation.create({
      data: {
        batchId: 'batch_base',
        controlId: 'SEC-ENC-001',
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1',
        status: 'IMPLEMENTED',
        trigger: 'MANUAL',
        evaluatedAt: new Date(),
        validUntil: new Date(Date.now() + 86400000),
        summary: 'Baseline healthy state',
        findings: [],
      },
    });

    await testPrisma.complianceControlState.create({
      data: {
        controlId: 'SEC-ENC-001',
        status: 'IMPLEMENTED',
        latestEvaluationId: baseEval.id,
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1',
        evaluatedAt: baseEval.evaluatedAt,
        validUntil: baseEval.validUntil,
        summary: baseEval.summary,
      },
    });

    // 2. Set up Transaction A (concurrent evaluation/evidence writer)
    let resolveTxACommit: () => void;
    const txACommitPromise = new Promise<void>(resolve => {
      resolveTxACommit = resolve;
    });

    let resolveTxAStarted: () => void;
    const txAStartedPromise = new Promise<void>(resolve => {
      resolveTxAStarted = resolve;
    });

    const txAPromise = testPrisma.$transaction(async txA => {
      const lateEval = await txA.complianceEvaluation.create({
        data: {
          batchId: 'batch_race',
          controlId: 'SEC-ENC-001',
          evaluatorId: 'encryption.at-rest',
          evaluatorVersion: '1',
          status: 'ACTION_REQUIRED',
          trigger: 'SCHEDULED',
          evaluatedAt: new Date(),
          validUntil: new Date(Date.now() + 86400000),
          summary: 'Concurrent evaluation',
          findings: [],
        },
      });

      await txA.complianceControlState.update({
        where: { controlId: 'SEC-ENC-001' },
        data: {
          status: 'ACTION_REQUIRED',
          latestEvaluationId: lateEval.id,
          evaluatorVersion: '1',
          evaluatedAt: lateEval.evaluatedAt,
          validUntil: lateEval.validUntil,
          summary: lateEval.summary,
        },
      });

      await txA.complianceEvidence.create({
        data: {
          evaluationId: lateEval.id,
          controlId: 'SEC-ENC-001',
          type: 'CONFIGURATION_SNAPSHOT',
          collectorId: 'encryption.at-rest',
          collectorVersion: '1.0.0',
          title: 'Concurrent evidence',
          observedAt: new Date(),
          contentHash: 'sha256:abcd',
          metadata: { note: 'created in Tx A' },
        },
      });

      // Signal Tx A has written records
      resolveTxAStarted();

      // Hold Tx A open until released
      await txACommitPromise;
    });

    // Wait until Tx A has written rows
    await txAStartedPromise;

    // Start export package generation.
    // Export begins its own REPEATABLE READ transaction while Tx A is still uncommitted!
    const exportPromise = exportComplianceEvidencePackage({
      scope: { type: 'CONTROLS', controlIds: ['SEC-ENC-001'] },
      evidenceSelection: { mode: 'SNAPSHOT' },
      userId: 'usr_auditor',
      prisma: testPrisma,
    });

    // Give export transaction a moment to start and establish its snapshot
    await new Promise(r => setTimeout(r, 60));

    // Release Tx A to commit
    resolveTxACommit!();
    await txAPromise;

    // Wait for export package to finish
    const pkg1 = await exportPromise;
    const zip1 = await JSZip.loadAsync(pkg1.zipBuffer);

    // Verify: Transaction A's evaluation and evidence are strictly ABSENT from this export
    const controlJson1 = JSON.parse(
      await zip1.file('controls/SEC-ENC-001/control.json')!.async('string')
    );
    expect(controlJson1.resolvedCurrentState).toBe('IMPLEMENTED'); // Baseline state, not ACTION_REQUIRED!
    expect(controlJson1.summary).toBe('Baseline healthy state');

    const evalJson1 = JSON.parse(
      await zip1.file('controls/SEC-ENC-001/evaluation.json')!.async('string')
    );
    expect(evalJson1.evaluationId).toBe(baseEval.id);

    const indexCsv1 = await zip1.file('summary/evidence-index.csv')!.async('text');
    expect(indexCsv1).not.toContain('Concurrent evidence');

    // 3. A subsequent export after Tx A is committed sees Tx A's state
    const pkg2 = await exportComplianceEvidencePackage({
      scope: { type: 'CONTROLS', controlIds: ['SEC-ENC-001'] },
      evidenceSelection: { mode: 'SNAPSHOT' },
      userId: 'usr_auditor',
      prisma: testPrisma,
    });

    const zip2 = await JSZip.loadAsync(pkg2.zipBuffer);
    const controlJson2 = JSON.parse(
      await zip2.file('controls/SEC-ENC-001/control.json')!.async('string')
    );
    expect(controlJson2.resolvedCurrentState).toBe('ACTION_REQUIRED');
    expect(controlJson2.summary).toBe('Concurrent evaluation');
  });
});
