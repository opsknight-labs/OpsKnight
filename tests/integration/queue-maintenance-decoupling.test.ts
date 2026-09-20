// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma } from '../helpers/test-db';
import { claimPendingJobs, runQueueMaintenance } from '@/lib/jobs/queue';
import { evaluateControl } from '@/lib/compliance/evaluation/engine';
import { computeComplianceControlRegistryFingerprint } from '@/lib/compliance/registry';
import { projectControlDrift, MAX_DRIFT_PROJECTION_BATCH } from '@/lib/compliance/drift/projector';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('queue maintenance decoupling & drift projection optimizations', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('keeps claimPendingJobs hot path decoupled from queue maintenance unless explicitly requested', async () => {
    // 1. Create a zombie ENCRYPTION_LIFECYCLE job stuck in PROCESSING
    const run = await testPrisma.encryptionMigrationRun.create({
      data: {
        mode: 'PREVIEW',
        status: 'RUNNING',
        registryFingerprint: 'test-fingerprint',
        activeKeyId: 'kms-active-1',
        totalRecords: 0,
        processedRecords: 0,
        migratedRecords: 0,
        errorRecords: 0,
        skippedRecords: 0,
        conflictRecords: 0,
      },
    });

    const job = await testPrisma.backgroundJob.create({
      data: {
        type: 'ENCRYPTION_LIFECYCLE',
        status: 'PROCESSING',
        attempts: 3,
        maxAttempts: 3,
        payload: { runId: run.id, mode: 'PREVIEW' },
        scheduledAt: new Date(Date.now() - 20 * 60 * 1000),
        startedAt: new Date(Date.now() - 15 * 60 * 1000), // > 10 min threshold
      },
    });

    // 2. Pure hot-path claimPendingJobs() should NOT run zombie reconciliation
    const claimed = await claimPendingJobs();
    expect(claimed).toEqual([]);

    const untouchedJob = await testPrisma.backgroundJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(untouchedJob.status).toBe('PROCESSING');

    // 3. Explicit runQueueMaintenance() cleans up the zombie job
    await runQueueMaintenance(testPrisma);

    const updatedJob = await testPrisma.backgroundJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(updatedJob.status).toBe('FAILED');
    expect(updatedJob.error).toContain('timed out in PROCESSING state');
  });

  it('does not enqueue duplicate COMPLIANCE_DRIFT_PROJECT job during scheduled sweeps', async () => {
    const fingerprint = computeComplianceControlRegistryFingerprint();

    // Evaluate a runtime control with SCHEDULED trigger
    await evaluateControl({
      controlId: 'SEC-ENC-001',
      trigger: 'SCHEDULED',
      context: {
        prisma: testPrisma,
        now: new Date(),
        controlRegistryFingerprint: fingerprint,
      },
    });

    const scheduledJobs = await testPrisma.backgroundJob.findMany({
      where: { type: 'COMPLIANCE_DRIFT_PROJECT' },
    });
    expect(scheduledJobs).toHaveLength(0);

    // Evaluate with MANUAL trigger
    await evaluateControl({
      controlId: 'SEC-ENC-001',
      trigger: 'MANUAL',
      context: {
        prisma: testPrisma,
        now: new Date(),
        controlRegistryFingerprint: fingerprint,
      },
    });

    const manualJobs = await testPrisma.backgroundJob.findMany({
      where: { type: 'COMPLIANCE_DRIFT_PROJECT' },
    });
    expect(manualJobs).toHaveLength(1);
    expect((manualJobs[0].payload as any).controlId).toBe('SEC-ENC-001');
  });

  it('bounds drift projection backlog and creates continuation job when batch ceiling is reached', async () => {
    expect(MAX_DRIFT_PROJECTION_BATCH).toBe(100);

    const now = new Date('2026-09-01T12:00:00.000Z');

    // Establish baseline
    const baselineEval = await testPrisma.complianceEvaluation.create({
      data: {
        controlId: 'SEC-ENC-001',
        status: 'IMPLEMENTED',
        evaluatorId: 'evaluator-1',
        evaluatorVersion: '1.0.0',
        summary: 'Baseline eval',
        findings: [],
        evidenceRefs: [],
        trigger: 'MANUAL',
        evaluatedAt: new Date('2026-09-01T10:00:00.000Z'),
        createdAt: new Date('2026-09-01T10:00:00.000Z'),
      },
    });

    await projectControlDrift({
      controlId: 'SEC-ENC-001',
      evaluationId: baselineEval.id,
      prisma: testPrisma,
      now,
    });

    // Create 105 evaluations (more than MAX_DRIFT_PROJECTION_BATCH = 100)
    const evalData = [];
    for (let i = 1; i <= 105; i++) {
      const evalDate = new Date(now.getTime() + i * 1000);
      evalData.push({
        id: `eval-backlog-${String(i).padStart(4, '0')}`,
        controlId: 'SEC-ENC-001',
        status: 'IMPLEMENTED' as const,
        evaluatorId: 'evaluator-1',
        evaluatorVersion: '1.0.0',
        summary: `Batch eval ${i}`,
        findings: [],
        evidenceRefs: [],
        trigger: 'MANUAL' as const,
        evaluatedAt: evalDate,
        createdAt: evalDate,
      });
    }

    await testPrisma.complianceEvaluation.createMany({
      data: evalData,
    });

    // Run drift projection
    const result = await projectControlDrift({
      controlId: 'SEC-ENC-001',
      prisma: testPrisma,
      now: new Date('2026-09-01T13:00:00.000Z'),
    });

    // Should only process up to MAX_DRIFT_PROJECTION_BATCH = 100
    expect(result.evaluationsProcessed).toBe(100);

    // Should have created continuation background job
    const continuationJobs = await testPrisma.backgroundJob.findMany({
      where: {
        type: 'COMPLIANCE_DRIFT_PROJECT',
      },
    });
    expect(continuationJobs.length).toBeGreaterThanOrEqual(1);
    const continuationJob = continuationJobs.find(
      j =>
        (j.payload as any)?.continuation === true && (j.payload as any)?.controlId === 'SEC-ENC-001'
    );
    expect(continuationJob).toBeDefined();
  });
});
