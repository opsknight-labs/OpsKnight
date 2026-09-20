// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma } from '../helpers/test-db';
import { startEncryptionRun } from '@/lib/encryption/worker';
import { processJob } from '@/lib/jobs/queue';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('encryption lifecycle queued PREVIEW (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('schedules real background job and processes PREVIEW run asynchronously to COMPLETED', async () => {
    // 1. Launch PREVIEW through the production path (runSynchronously: false)
    const run = await startEncryptionRun(testPrisma, {
      mode: 'PREVIEW',
      runSynchronously: false,
    });

    expect(run).toBeDefined();
    expect(run.mode).toBe('PREVIEW');
    expect(run.status).toBe('PENDING');

    // 2. Verify BackgroundJob exists in database with type ENCRYPTION_LIFECYCLE and runId
    const job = await testPrisma.backgroundJob.findFirst({
      where: {
        type: 'ENCRYPTION_LIFECYCLE',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(job).toBeDefined();
    expect(job?.status).toBe('PENDING');
    const payload = job?.payload as { runId?: string };
    expect(payload.runId).toBe(run.id);

    // 3. Process the background job through the real worker path
    const success = await processJob(job!.id);
    expect(success).toBe(true);

    // 4. Verify BackgroundJob transitioned to COMPLETED
    const updatedJob = await testPrisma.backgroundJob.findUnique({
      where: { id: job!.id },
    });
    expect(updatedJob?.status).toBe('COMPLETED');
    expect(updatedJob?.completedAt).not.toBeNull();

    // 5. Verify EncryptionMigrationRun transitioned from PENDING to COMPLETED
    const completedRun = await testPrisma.encryptionMigrationRun.findUnique({
      where: { id: run.id },
      include: { targetStates: true },
    });

    expect(completedRun?.status).toBe('COMPLETED');
    expect(completedRun?.completedAt).not.toBeNull();
    expect(completedRun?.targetStates.length).toBeGreaterThan(0);

    // 6. Verify inspectionStats are populated for preview
    for (const targetState of completedRun!.targetStates) {
      expect(targetState.inspectionStats).toBeDefined();
      expect(typeof targetState.inspectionStats).toBe('object');
    }
  });

  it('prevents starting duplicate run while a run is PENDING or RUNNING', async () => {
    const run = await startEncryptionRun(testPrisma, {
      mode: 'PREVIEW',
      runSynchronously: false,
    });

    expect(run.status).toBe('PENDING');

    await expect(
      startEncryptionRun(testPrisma, {
        mode: 'PREVIEW',
        runSynchronously: false,
      })
    ).rejects.toThrow(/currently in progress/);
  });
});
