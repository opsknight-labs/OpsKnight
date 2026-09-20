// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma } from '../helpers/test-db';
import { projectControlDrift } from '@/lib/compliance/drift/projector';
import { ensureComplianceMonitoringScheduled } from '@/lib/compliance/monitoring/schedule';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('compliance drift concurrency (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('safely handles 25 concurrent projectControlDrift calls without duplicates or deadlocks', async () => {
    const controlId = 'ENC-01';

    // Seed initial baseline evaluation
    await testPrisma.complianceEvaluation.create({
      data: {
        controlId,
        status: 'IMPLEMENTED',
        trigger: 'SCHEDULED',
        evaluatorId: 'eval-enc-01',
        evaluatorVersion: '1.0.0',
        summary: 'Baseline check',
        evaluatedAt: new Date('2026-09-20T10:00:00.000Z'),
      },
    });

    await projectControlDrift({ controlId, prisma: testPrisma });

    // Now seed regressed evaluation
    await testPrisma.complianceEvaluation.create({
      data: {
        controlId,
        status: 'ACTION_REQUIRED',
        trigger: 'SCHEDULED',
        evaluatorId: 'eval-enc-01',
        evaluatorVersion: '1.0.0',
        summary: 'Regressed cipher',
        evaluatedAt: new Date('2026-09-20T11:00:00.000Z'),
      },
    });

    // Fire 25 parallel projection requests
    const promises = Array.from({ length: 25 }, () =>
      projectControlDrift({ controlId, prisma: testPrisma })
    );

    const results = await Promise.allSettled(promises);
    const rejected = results.filter(r => r.status === 'rejected');
    if (rejected.length > 0) {
      console.error('REJECTED SAMPLES:', rejected.slice(0, 3));
    }
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(25);

    // Verify exactly ONE open drift event exists
    const openEvents = await testPrisma.complianceDriftEvent.findMany({
      where: { controlId, status: 'OPEN' },
    });
    expect(openEvents).toHaveLength(1);
    expect(openEvents[0].activeDedupeKey).toBeTruthy();
  });

  it('safely handles concurrent scheduler bootstraps ensuring only ONE active sweep job is queued', async () => {
    const promises = Array.from({ length: 10 }, () =>
      ensureComplianceMonitoringScheduled(testPrisma)
    );

    await Promise.all(promises);

    const sweepJobs = await testPrisma.backgroundJob.findMany({
      where: {
        type: 'COMPLIANCE_EVALUATION_SWEEP',
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    });

    expect(sweepJobs).toHaveLength(1);
  });
});
