// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma } from '../helpers/test-db';
import { startEncryptionRun, settleEncryptionLifecycleFailure } from '@/lib/encryption/worker';
import { claimPendingJobs } from '@/lib/jobs/queue';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('encryption zombie sweeper & non-clobbering settlement (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('reconciles zombie PROCESSING jobs and settles orphaned EncryptionMigrationRun to FAILED', async () => {
    // 1. Create an active migration run in RUNNING state
    const run = await testPrisma.encryptionMigrationRun.create({
      data: {
        mode: 'PREVIEW',
        status: 'RUNNING',
        registryFingerprint: 'test-fingerprint-zombie',
        activeKeyId: 'kms-active-1',
        totalRecords: 10,
        processedRecords: 2,
        migratedRecords: 0,
        errorRecords: 0,
        skippedRecords: 0,
        conflictRecords: 0,
        startedAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    });

    // 2. Create an associated BackgroundJob in PROCESSING that timed out
    const job = await testPrisma.backgroundJob.create({
      data: {
        type: 'ENCRYPTION_LIFECYCLE',
        status: 'PROCESSING',
        attempts: 3,
        maxAttempts: 3,
        payload: { runId: run.id, mode: 'PREVIEW' },
        scheduledAt: new Date(Date.now() - 20 * 60 * 1000),
        startedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 mins ago (> 10m threshold)
      },
    });

    // 3. Trigger claimPendingJobs with maintenance option (or runQueueMaintenance)
    await claimPendingJobs(50, undefined, [], { runMaintenance: true });

    // 4. Verify BackgroundJob was transitioned to FAILED
    const updatedJob = await testPrisma.backgroundJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(updatedJob.status).toBe('FAILED');
    expect(updatedJob.error).toContain('timed out in PROCESSING state');

    // 5. Verify EncryptionMigrationRun was atomically transitioned to FAILED
    const updatedRun = await testPrisma.encryptionMigrationRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(updatedRun.status).toBe('FAILED');
    expect(updatedRun.errorMessage).toContain('timed out in PROCESSING state');
    expect(updatedRun.completedAt).not.toBeNull();

    // 6. Verify subsequent run is immediately unblocked
    const nextRun = await startEncryptionRun(testPrisma, {
      mode: 'PREVIEW',
      runSynchronously: false,
    });
    expect(nextRun).toBeDefined();
    expect(nextRun.id).not.toBe(run.id);
    expect(nextRun.status).toBe('PENDING');
  });

  it('never overwrites COMPLETED or CANCELLED runs when settling lifecycle failure', async () => {
    // 1. Create a completed migration run
    const completedRun = await testPrisma.encryptionMigrationRun.create({
      data: {
        mode: 'MIGRATE',
        status: 'COMPLETED',
        registryFingerprint: 'test-fingerprint-completed',
        activeKeyId: 'kms-active-1',
        totalRecords: 10,
        processedRecords: 10,
        migratedRecords: 10,
        errorRecords: 0,
        skippedRecords: 0,
        conflictRecords: 0,
        completedAt: new Date(),
      },
    });

    // 2. Attempt late failure settlement (e.g. late racing worker)
    const settled = await settleEncryptionLifecycleFailure(
      testPrisma,
      completedRun.id,
      'Late network timeout'
    );
    expect(settled).toBe(false);

    // 3. Verify status was not overwritten
    const checkRun = await testPrisma.encryptionMigrationRun.findUniqueOrThrow({
      where: { id: completedRun.id },
    });
    expect(checkRun.status).toBe('COMPLETED');
    expect(checkRun.errorMessage).toBeNull();
  });
});
