import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';
import { evaluateControl, evaluateControls } from '@/lib/compliance/evaluation';
import { computeRegistryFingerprint } from '@/lib/encryption/registry';
import { computeComplianceControlRegistryFingerprint } from '@/lib/compliance/registry';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('compliance runtime control evaluation (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
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

  it('evaluates SEC-ENC-001 as IMPLEMENTED when a clean VERIFY run exists', async () => {
    const admin = await createTestUser({ role: 'ADMIN', status: 'ACTIVE' });
    const registryFingerprint = computeRegistryFingerprint();

    const verifyRun = await testPrisma.encryptionMigrationRun.create({
      data: {
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint,
        activeKeyId: 'default-active-key',
        initiatedById: admin.id,
        completedAt: new Date(),
        errorRecords: 0,
        conflictRecords: 0,
      },
    });

    await testPrisma.encryptionMigrationTargetState.create({
      data: {
        runId: verifyRun.id,
        targetId: 'ApiKey.hashedKey',
        status: 'COMPLETED',
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
        activeKeyId: 'default-active-key',
        initiatedById: admin.id,
        completedAt: new Date(),
        errorRecords: 2,
        conflictRecords: 0,
      },
    });

    await testPrisma.encryptionMigrationTargetState.create({
      data: {
        runId: verifyRun.id,
        targetId: 'ApiKey.hashedKey',
        status: 'COMPLETED',
        totalCount: 5,
        processedCount: 5,
        migratedCount: 0,
        errorCount: 2,
        conflictCount: 0,
        inspectionStats: {
          currentV3: 3,
          oldKeyV3: 0,
          legacyV2: 0,
          legacyV1: 0,
          plaintext: 0,
          unavailableKey: 0,
          ambiguous: 0,
          unreadable: 2,
          empty: 0,
        },
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
  });
});
