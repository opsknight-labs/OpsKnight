import { afterAll, beforeEach, expect, it } from 'vitest';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
import { candidateEvidenceFreshness } from '@/lib/automation/evidence-freshness';

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await db.backgroundJob.deleteMany({ where: { id: { startsWith: 'freshness-' } } });
  await db.$disconnect();
});
it('scopes pending evidence to the candidate and reports the daily evidence granularity', async () => {
  const createdAt = new Date(Date.now() - 5000);
  await db.backgroundJob.createMany({
    data: [
      {
        id: 'freshness-relevant',
        status: 'PENDING' as const,
        serviceId: 'service',
        versionId: 'candidate',
      },
      {
        id: 'freshness-other-service',
        status: 'PENDING' as const,
        serviceId: 'other',
        versionId: 'candidate',
      },
      {
        id: 'freshness-other-version',
        status: 'PENDING' as const,
        serviceId: 'service',
        versionId: 'old',
      },
      {
        id: 'freshness-completed',
        status: 'COMPLETED' as const,
        serviceId: 'service',
        versionId: 'candidate',
      },
    ].map(({ id, status, serviceId, versionId }) => ({
      id,
      type: 'SCHEDULED_TASK' as const,
      status,
      scheduledAt: createdAt,
      createdAt,
      payload: { task: 'AUTOMATION_OBSERVE', serviceId, shadow: { versionId } },
    })),
  });
  const bucket = new Date('2026-10-18T00:00:00Z');
  const result = await candidateEvidenceFreshness(db, 'service', 'candidate', bucket);
  expect(result).toMatchObject({
    latestEvidenceBucketDate: bucket.toISOString(),
    pendingObservations: 1,
    pendingObservationsTruncated: false,
  });
  expect(result.oldestSampledPendingAgeMs).toBeGreaterThanOrEqual(5000);
});
it('caps pending samples and explicitly distinguishes missing evidence', async () => {
  await db.backgroundJob.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      id: `freshness-${i}`,
      type: 'SCHEDULED_TASK' as const,
      scheduledAt: new Date(),
      payload: {
        task: 'AUTOMATION_OBSERVE',
        serviceId: 'service',
        shadow: { versionId: 'candidate' },
      },
    })),
  });
  expect(await candidateEvidenceFreshness(db, 'service', 'candidate', null)).toMatchObject({
    latestEvidenceBucketDate: null,
    pendingObservations: 100,
    pendingObservationsTruncated: true,
  });
});
