import { afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
import { claimPendingJobs, markJobCompleted, markJobFailed } from '@/lib/jobs/queue';

beforeEach(resetDatabase, 30_000);
afterAll(() => db.$disconnect());

async function claimed(task: string, ageSeconds: number) {
  return db.backgroundJob.create({
    data: {
      type: 'SCHEDULED_TASK',
      status: 'PROCESSING',
      claimToken: randomUUID(),
      attempts: 1,
      scheduledAt: new Date(Date.now() - 60_000),
      startedAt: new Date(Date.now() - ageSeconds * 1000),
      payload: { task, serviceId: 'recovery-fixture' },
    },
  });
}

it('reclaims orphaned automation work after twenty seconds and fences the old attempt', async () => {
  const job = await claimed('AUTOMATION_OBSERVE', 21);
  const [next] = await claimPendingJobs(1);
  expect(next.id).toBe(job.id);
  expect(next.attempts).toBe(2);
  expect(next.claimToken).not.toBe(job.claimToken);
  await markJobCompleted(job.id, 1, job.claimToken);
  await markJobFailed(job.id, 'late failure from the terminated worker', 1, job.claimToken);
  expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: 'PROCESSING',
    attempts: 2,
    error: null,
  });
  await markJobCompleted(job.id, 2, next.claimToken);
  expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
    'COMPLETED'
  );
});

it('does not steal a recently heartbeating operational claim', async () => {
  await claimed('AUTOMATION_OBSERVE', 5);
  expect(await claimPendingJobs(1)).toEqual([]);
});

it('preserves the existing long timeout for unrelated scheduled work', async () => {
  await claimed('COMPLIANCE_LIFECYCLE_FIXTURE', 21);
  expect(await claimPendingJobs(1)).toEqual([]);
});

it('fences the prior token even when retry-neutral handling reuses the attempt count', async () => {
  const job = await claimed('AUTOMATION_OBSERVE', 21);
  const [next] = await claimPendingJobs(1);
  await db.backgroundJob.update({ where: { id: job.id }, data: { attempts: 1 } });
  await markJobCompleted(job.id, 1, job.claimToken);
  await markJobFailed(job.id, 'stale retry-neutral failure', 1, job.claimToken);
  expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: 'PROCESSING',
    attempts: 1,
    claimToken: next.claimToken,
    error: null,
  });
});

it('preserves the long timeout for tokenless legacy claims', async () => {
  const job = await claimed('AUTOMATION_OBSERVE', 21);
  await db.backgroundJob.update({ where: { id: job.id }, data: { claimToken: null } });
  expect(await claimPendingJobs(1)).toEqual([]);
});
