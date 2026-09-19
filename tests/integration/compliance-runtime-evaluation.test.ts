import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';
import { evaluateControl, evaluateControls } from '@/lib/compliance/evaluation';
import { computeRegistryFingerprint, ENCRYPTION_TARGETS } from '@/lib/encryption/registry';
import { getActiveKeyId } from '@/lib/encryption';
import { computeComplianceControlRegistryFingerprint } from '@/lib/compliance/registry';
import { complianceEvaluatorRegistry } from '@/lib/compliance/evaluators';
import { verifyComplianceEvidenceHash } from '@/lib/compliance/evidence/hash';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('compliance runtime control evaluation (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
    // Seed default system settings for read-only retention inspection
    await testPrisma.systemSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: {
        id: 'default',
        incidentRetentionDays: 730,
        alertRetentionDays: 365,
        logRetentionDays: 365,
        metricsRetentionDays: 365,
        completedPrivacyRequestRetentionDays: 730,
      },
    });
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('evaluates SEC-ENC-001 as UNVERIFIED if no completed VERIFY run exists', async () => {
    const context = {
      prisma: testPrisma,
      now: new Date(),
      controlRegistryFingerprint: computeComplianceControlRegistryFingerprint(),
    };

    const outcome = await evaluateControl({
      controlId: 'SEC-ENC-001',
      context,
      trigger: 'MANUAL',
    });

    expect(outcome.evaluation.status).toBe('UNVERIFIED');
    expect(outcome.controlState.status).toBe('UNVERIFIED');
    expect(outcome.evaluation.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'VERIFICATION_MISSING' })])
    );
  });

  it('evaluates SEC-ENC-001 as UNVERIFIED if latest VERIFY run is missing registered targets', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const registryFingerprint = computeRegistryFingerprint();

    const verifyRun = await testPrisma.encryptionMigrationRun.create({
      data: {
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint,
        activeKeyId: getActiveKeyId() ?? 'dev',
        initiatedById: admin.id,
        completedAt: new Date(),
        errorRecords: 0,
        conflictRecords: 0,
      },
    });

    // Incomplete coverage: seed only one target instead of all ENCRYPTION_TARGETS
    await testPrisma.encryptionMigrationTargetState.create({
      data: {
        runId: verifyRun.id,
        targetId: ENCRYPTION_TARGETS[0].id,
        status: 'COMPLETED',
        totalCount: 5,
        processedCount: 5,
        migratedCount: 0,
        errorCount: 0,
        conflictCount: 0,
        inspectionStats: { currentV3: 5 },
      },
    });

    const context = {
      prisma: testPrisma,
      now: new Date(),
      controlRegistryFingerprint: computeComplianceControlRegistryFingerprint(),
    };

    const outcome = await evaluateControl({
      controlId: 'SEC-ENC-001',
      context,
      trigger: 'MANUAL',
    });

    expect(outcome.evaluation.status).toBe('UNVERIFIED');
    expect(outcome.controlState.status).toBe('UNVERIFIED');
    expect(outcome.evaluation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'INCOMPLETE_VERIFICATION_COVERAGE' }),
      ])
    );
  });

  it('evaluates SEC-ENC-001 as UNVERIFIED if active key changed since latest verification', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const registryFingerprint = computeRegistryFingerprint();

    const verifyRun = await testPrisma.encryptionMigrationRun.create({
      data: {
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint,
        activeKeyId: 'stale-pre-rotation-key',
        initiatedById: admin.id,
        completedAt: new Date(),
        errorRecords: 0,
        conflictRecords: 0,
      },
    });

    await testPrisma.encryptionMigrationTargetState.createMany({
      data: ENCRYPTION_TARGETS.map(t => ({
        runId: verifyRun.id,
        targetId: t.id,
        status: 'COMPLETED' as const,
        totalCount: 10,
        processedCount: 10,
        migratedCount: 0,
        errorCount: 0,
        conflictCount: 0,
        inspectionStats: { currentV3: 10 },
      })),
    });

    const context = {
      prisma: testPrisma,
      now: new Date(),
      controlRegistryFingerprint: computeComplianceControlRegistryFingerprint(),
    };

    const outcome = await evaluateControl({
      controlId: 'SEC-ENC-001',
      context,
      trigger: 'MANUAL',
    });

    expect(outcome.evaluation.status).toBe('UNVERIFIED');
    expect(outcome.controlState.status).toBe('UNVERIFIED');
    expect(outcome.evaluation.summary).toContain(
      'active encryption key changed since the latest verification'
    );
    expect(outcome.evaluation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ACTIVE_KEY_CHANGED_SINCE_VERIFICATION' }),
      ])
    );
  });

  it('evaluates SEC-ENC-001 as IMPLEMENTED when all registered targets are verified clean on active key', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const registryFingerprint = computeRegistryFingerprint();

    const verifyRun = await testPrisma.encryptionMigrationRun.create({
      data: {
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint,
        activeKeyId: getActiveKeyId() ?? 'dev',
        initiatedById: admin.id,
        completedAt: new Date(),
        errorRecords: 0,
        conflictRecords: 0,
      },
    });

    // Complete coverage across every ENCRYPTION_TARGETS member
    await testPrisma.encryptionMigrationTargetState.createMany({
      data: ENCRYPTION_TARGETS.map(t => ({
        runId: verifyRun.id,
        targetId: t.id,
        status: 'COMPLETED' as const,
        totalCount: 10,
        processedCount: 10,
        migratedCount: 0,
        errorCount: 0,
        conflictCount: 0,
        inspectionStats: {
          currentV3: 10,
          oldKeyV3: 0,
          legacyV2: 0,
          legacyV1: 0,
          plaintext: 0,
          unavailableKey: 0,
          ambiguous: 0,
          unreadable: 0,
          empty: 0,
        },
      })),
    });

    const context = {
      prisma: testPrisma,
      now: new Date(),
      controlRegistryFingerprint: computeComplianceControlRegistryFingerprint(),
    };

    const outcome = await evaluateControl({
      controlId: 'SEC-ENC-001',
      context,
      trigger: 'MANUAL',
    });

    expect(outcome.evaluation.status).toBe('IMPLEMENTED');
    expect(outcome.controlState.status).toBe('IMPLEMENTED');
    expect(outcome.evaluation.summary).toContain('authenticated on the active key');
  });

  it('evaluates SEC-ENC-001 as ACTION_REQUIRED when unreadable records exist in latest verification', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const registryFingerprint = computeRegistryFingerprint();

    const verifyRun = await testPrisma.encryptionMigrationRun.create({
      data: {
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint,
        activeKeyId: getActiveKeyId() ?? 'dev',
        initiatedById: admin.id,
        completedAt: new Date(),
        errorRecords: 2,
        conflictRecords: 0,
      },
    });

    await testPrisma.encryptionMigrationTargetState.createMany({
      data: ENCRYPTION_TARGETS.map((t, index) => ({
        runId: verifyRun.id,
        targetId: t.id,
        status: 'COMPLETED' as const,
        totalCount: 5,
        processedCount: 5,
        migratedCount: 0,
        errorCount: index === 0 ? 2 : 0,
        conflictCount: 0,
        inspectionStats: {
          currentV3: index === 0 ? 3 : 5,
          oldKeyV3: 0,
          legacyV2: 0,
          legacyV1: 0,
          plaintext: 0,
          unavailableKey: 0,
          ambiguous: 0,
          unreadable: index === 0 ? 2 : 0,
          empty: 0,
        },
      })),
    });

    const context = {
      prisma: testPrisma,
      now: new Date(),
      controlRegistryFingerprint: computeComplianceControlRegistryFingerprint(),
    };

    const outcome = await evaluateControl({
      controlId: 'SEC-ENC-001',
      context,
      trigger: 'MANUAL',
    });

    expect(outcome.evaluation.status).toBe('ACTION_REQUIRED');
    expect(outcome.controlState.status).toBe('ACTION_REQUIRED');
    expect(outcome.evaluation.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'UNREADABLE_RECORDS', value: 2 })])
    );
  });

  it('maintains historical audit trail in ComplianceEvaluation and updates ComplianceControlState', async () => {
    const context = {
      prisma: testPrisma,
      now: new Date(),
      controlRegistryFingerprint: computeComplianceControlRegistryFingerprint(),
    };

    const outcome1 = await evaluateControl({
      controlId: 'PRIV-HOLD-001',
      context,
      trigger: 'MANUAL',
    });

    const outcome2 = await evaluateControl({
      controlId: 'PRIV-HOLD-001',
      context,
      trigger: 'MANUAL',
    });

    const historyCount = await testPrisma.complianceEvaluation.count({
      where: { controlId: 'PRIV-HOLD-001' },
    });
    expect(historyCount).toBe(2);

    const states = await testPrisma.complianceControlState.findMany({
      where: { controlId: 'PRIV-HOLD-001' },
    });
    expect(states).toHaveLength(1);
    expect(states[0].latestEvaluationId).toBe(outcome2.evaluation.id);
    expect(outcome1.evaluation.id).not.toBe(outcome2.evaluation.id);
  });

  it('prevents stale evaluation from overwriting newer state under concurrent execution (real PostgreSQL advisory lock)', async () => {
    let resolveA: () => void;
    const pauseA = new Promise<void>(res => {
      resolveA = res;
    });

    const originalEvaluator = complianceEvaluatorRegistry['authorization.rbac'];

    let aCalled = false;
    complianceEvaluatorRegistry['authorization.rbac'] = {
      id: 'authorization.rbac',
      version: '1',
      async evaluate() {
        if (!aCalled) {
          aCalled = true;
          await pauseA;
          return {
            status: 'ACTION_REQUIRED',
            summary: 'Stale Evaluation A Result',
            findings: [],
            evidence: [],
            evidenceRefs: [],
          };
        }
        return {
          status: 'IMPLEMENTED',
          summary: 'Newer Evaluation B Result',
          findings: [],
          evidence: [],
          evidenceRefs: [],
        };
      },
    };

    try {
      const nowA = new Date('2026-09-19T10:00:00Z');
      const nowB = new Date('2026-09-19T11:00:00Z');

      // Start Evaluation A (will pause inside evaluate())
      const promiseA = evaluateControl({
        controlId: 'SEC-AUTHZ-001',
        context: {
          prisma: testPrisma,
          now: nowA,
          controlRegistryFingerprint: computeComplianceControlRegistryFingerprint(),
        },
        trigger: 'MANUAL',
      });

      // Wait a tick to ensure A has started and is paused
      await new Promise(r => setTimeout(r, 50));

      // Execute Evaluation B to completion
      const outcomeB = await evaluateControl({
        controlId: 'SEC-AUTHZ-001',
        context: {
          prisma: testPrisma,
          now: nowB,
          controlRegistryFingerprint: computeComplianceControlRegistryFingerprint(),
        },
        trigger: 'MANUAL',
      });

      expect(outcomeB.controlState.status).toBe('IMPLEMENTED');
      expect(outcomeB.controlState.summary).toBe('Newer Evaluation B Result');

      // Resume Evaluation A
      resolveA!();
      const outcomeA = await promiseA;

      // Evaluation A records its own historical evaluation
      expect(outcomeA.evaluation.summary).toBe('Stale Evaluation A Result');

      // But the returned controlState must remain B's newer state!
      expect(outcomeA.controlState.latestEvaluationId).toBe(outcomeB.evaluation.id);
      expect(outcomeA.controlState.summary).toBe('Newer Evaluation B Result');

      // Database state must remain B's newer state!
      const finalDbState = await testPrisma.complianceControlState.findUniqueOrThrow({
        where: { controlId: 'SEC-AUTHZ-001' },
      });
      expect(finalDbState.latestEvaluationId).toBe(outcomeB.evaluation.id);
      expect(finalDbState.summary).toBe('Newer Evaluation B Result');
      expect(finalDbState.status).toBe('IMPLEMENTED');

      // Both evaluations are safely preserved in historical log
      const evaluations = await testPrisma.complianceEvaluation.findMany({
        where: { controlId: 'SEC-AUTHZ-001' },
        orderBy: { evaluatedAt: 'asc' },
      });
      expect(evaluations).toHaveLength(2);
      expect(evaluations[0].id).toBe(outcomeA.evaluation.id);
      expect(evaluations[1].id).toBe(outcomeB.evaluation.id);
    } finally {
      complianceEvaluatorRegistry['authorization.rbac'] = originalEvaluator;
    }
  });

  it('evaluates all runtime controls in a batch and records audit events', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });

    const batchResult = await evaluateControls({
      trigger: 'API',
      actor: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
      },
    });

    expect(batchResult.evaluations).toHaveLength(6);
    expect(batchResult.summary.total).toBe(6);

    const states = await testPrisma.complianceControlState.findMany();
    expect(states.length).toBeGreaterThanOrEqual(6);

    const auditLogs = await testPrisma.auditLog.findMany({
      where: {
        entityType: 'COMPLIANCE_EVALUATION',
        entityId: batchResult.batchId,
      },
      orderBy: { createdAt: 'asc' },
    });

    expect(auditLogs).toHaveLength(2);
    expect(auditLogs[0].action).toBe('COMPLIANCE_EVALUATION_STARTED');
    expect(auditLogs[0].actorId).toBe(admin.id);
    expect(auditLogs[1].action).toBe('COMPLIANCE_EVALUATION_COMPLETED');
    expect(auditLogs[1].actorId).toBe(admin.id);
    const details = auditLogs[1].details as Record<string, unknown>;
    const metadata = (details?.metadata as Record<string, unknown>) ?? {};
    expect(metadata.summary).toEqual(
      expect.objectContaining({
        total: 6,
        evidenceRecordsCreated: expect.any(Number),
      })
    );

    // Verify evidence records were persisted for every evaluation
    const totalEvidence = await testPrisma.complianceEvidence.count();
    expect(totalEvidence).toBeGreaterThanOrEqual(6);
  });

  it('atomically persists evaluation, evidence records, and state projection with verified SHA-256 hashes', async () => {
    const context = {
      prisma: testPrisma,
      now: new Date(),
      controlRegistryFingerprint: computeComplianceControlRegistryFingerprint(),
    };

    const outcome = await evaluateControl({
      controlId: 'SEC-RETENTION-001',
      context,
      trigger: 'MANUAL',
    });

    expect(outcome.evaluation.status).toBe('IMPLEMENTED');
    expect(outcome.evidenceCount).toBeGreaterThanOrEqual(2);

    // Fetch persisted evidence records directly from PostgreSQL
    const evidenceRecords = await testPrisma.complianceEvidence.findMany({
      where: { evaluationId: outcome.evaluation.id },
      orderBy: { observedAt: 'asc' },
    });

    expect(evidenceRecords).toHaveLength(outcome.evidenceCount);

    for (const record of evidenceRecords) {
      expect(record.controlId).toBe('SEC-RETENTION-001');
      expect(record.evaluationId).toBe(outcome.evaluation.id);
      expect(record.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);

      // Verify SHA-256 canonical digest integrity against the database record
      const isValid = verifyComplianceEvidenceHash({
        controlId: record.controlId,
        evaluationId: record.evaluationId,
        type: record.type,
        collectorId: record.collectorId,
        collectorVersion: record.collectorVersion,
        resourceType: record.resourceType,
        resourceId: record.resourceId,
        observedAt: record.observedAt,
        validUntil: record.validUntil,
        metadata: record.metadata as Record<string, unknown>,
        contentHash: record.contentHash,
      });

      expect(isValid).toBe(true);
    }
  });

  it('fails safely to UNVERIFIED with EVALUATION_FAILURE evidence when evidence contains forbidden sensitive keys', async () => {
    const originalEvaluator = complianceEvaluatorRegistry['data.retention'];

    try {
      complianceEvaluatorRegistry['data.retention'] = {
        id: 'data.retention',
        version: '1',
        evaluate: async () => ({
          status: 'IMPLEMENTED' as const,
          summary: 'Leaky evaluator implementation',
          findings: [],
          evidence: [
            {
              type: 'CONFIGURATION_SNAPSHOT' as const,
              collectorId: 'data.retention',
              collectorVersion: '1',
              title: 'Leaky Retention Config',
              observedAt: new Date(),
              metadata: {
                adminSecretToken: 'super-secret-token-12345',
              },
            },
          ],
          evidenceRefs: [],
        }),
      };

      const context = {
        prisma: testPrisma,
        now: new Date(),
        controlRegistryFingerprint: computeComplianceControlRegistryFingerprint(),
      };

      const outcome = await evaluateControl({
        controlId: 'SEC-RETENTION-001',
        context,
        trigger: 'MANUAL',
      });

      expect(outcome.evaluation.status).toBe('UNVERIFIED');
      expect(outcome.evaluation.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'EVIDENCE_VALIDATION_FAILED' })])
      );
      expect(outcome.controlState.status).toBe('UNVERIFIED');

      // Database should contain the safe EVALUATION_FAILURE record, NOT the leaky token
      const dbEvidence = await testPrisma.complianceEvidence.findMany({
        where: { evaluationId: outcome.evaluation.id },
      });

      expect(dbEvidence).toHaveLength(1);
      expect(dbEvidence[0].type).toBe('EVALUATION_FAILURE');
      expect(dbEvidence[0].title).toBe('Evidence Validation Failure');
      expect(JSON.stringify(dbEvidence[0].metadata)).not.toContain('adminSecretToken');
      expect(JSON.stringify(dbEvidence[0].metadata)).not.toContain('super-secret-token');
    } finally {
      complianceEvaluatorRegistry['data.retention'] = originalEvaluator;
    }
  });
});
