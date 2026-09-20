// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma } from '../helpers/test-db';
import { startEncryptionRun } from '@/lib/encryption/worker';
import { markJobFailed } from '@/lib/jobs/queue';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('encryption lifecycle terminal failure settlement (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('settles EncryptionMigrationRun to FAILED when background job fails terminally', async () => {
    // 1. Schedule run
    const run = await startEncryptionRun(testPrisma, {
      mode: 'PREVIEW',
      runSynchronously: false,
    });
    expect(run.status).toBe('PENDING');

    // 2. Find background job
    const job = await testPrisma.backgroundJob.findFirstOrThrow({
      where: { type: 'ENCRYPTION_LIFECYCLE' },
    });

    // 3. Mark job attempts to maxAttempts - 1 so the next failure is terminal
    await testPrisma.backgroundJob.update({
      where: { id: job.id },
      data: { attempts: job.maxAttempts },
    });

    // 4. Trigger terminal failure
    await markJobFailed(job.id, 'Simulated worker fatal exception: KMS key revoked');

    // 5. Verify background job is FAILED
    const failedJob = await testPrisma.backgroundJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(failedJob.status).toBe('FAILED');
    expect(failedJob.error).toContain('KMS key revoked');

    // 6. Verify EncryptionMigrationRun has settled to FAILED
    const failedRun = await testPrisma.encryptionMigrationRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(failedRun.status).toBe('FAILED');
    expect(failedRun.errorMessage).toContain('KMS key revoked');
    expect(failedRun.completedAt).not.toBeNull();

    // 7. Verify subsequent run is unblocked
    const nextRun = await startEncryptionRun(testPrisma, {
      mode: 'PREVIEW',
      runSynchronously: false,
    });
    expect(nextRun).toBeDefined();
    expect(nextRun.id).not.toBe(run.id);
    expect(nextRun.status).toBe('PENDING');
  });
});
