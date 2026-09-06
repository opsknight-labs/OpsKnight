import { describe, it, expect, beforeEach } from 'vitest';
import { scheduleJob, claimPendingJobs, markJobFailed, processJob } from '@/lib/jobs/queue';
import { testPrisma, resetDatabase } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('Job Queue Resilience Tests', { timeout: 30000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('Atomic Job Claiming (FOR UPDATE SKIP LOCKED)', () => {
    it('should prevent multiple workers from claiming the same job', async () => {
      // 1. Create 5 pending jobs
      for (let i = 0; i < 5; i++) {
        await scheduleJob('SCHEDULED_TASK', new Date(), { task: `task-${i}` });
      }

      // 2. Simulate 3 workers claiming simultaneously
      // Each try to claim up to 10 jobs
      const workers = [claimPendingJobs(10), claimPendingJobs(10), claimPendingJobs(10)];

      const results = await Promise.all(workers);

      // 3. Verify total claimed jobs is exactly 5
      const totalClaimed = results.reduce((acc, jobs) => acc + jobs.length, 0);
      expect(totalClaimed).toBe(5);

      // 4. Verify no job was claimed by more than one worker
      const jobIds = results.flatMap(jobs => jobs.map(j => j.id));
      const uniqueJobIds = new Set(jobIds);
      expect(uniqueJobIds.size).toBe(5);

      // 5. Verify DB state is 'PROCESSING' for all
      const processingCount = await testPrisma.backgroundJob.count({
        where: { status: 'PROCESSING' },
      });
      expect(processingCount).toBe(5);
    });
  });

  describe('Retry Logic and Exponential Backoff', () => {
    it('should reschedule failed jobs with backoff and eventually mark as FAILED', async () => {
      // Schedule job 1 second in the past to ensure it's immediately claimable
      const pastTime = new Date(Date.now() - 1000);
      const jobId = await scheduleJob('NOTIFICATION', pastTime, { message: 'fail me' }, 3);

      // Attempt 1: Claim first (increments attempts to 1)
      await claimPendingJobs(1);
      await markJobFailed(jobId, 'First failure');
      let job = await testPrisma.backgroundJob.findUnique({ where: { id: jobId } });
      expect(job?.status).toBe('PENDING');
      expect(job?.attempts).toBe(1);
      // Backoff: 2^1 * 5000 = 10s
      const now = Date.now();
      expect(job?.scheduledAt!.getTime()).toBeGreaterThanOrEqual(now + 9000);

      // Attempt 2: Claim again (increments attempts to 2)
      // Use past time to ensure claim works
      await testPrisma.backgroundJob.update({
        where: { id: jobId },
        data: { scheduledAt: new Date(Date.now() - 1000) },
      });
      await claimPendingJobs(1);
      await markJobFailed(jobId, 'Second failure');
      job = await testPrisma.backgroundJob.findUnique({ where: { id: jobId } });
      expect(job?.status).toBe('PENDING');
      expect(job?.attempts).toBe(2);

      // Attempt 3: Final attempt (increments attempts to 3)
      // Use past time to ensure claim works
      await testPrisma.backgroundJob.update({
        where: { id: jobId },
        data: { scheduledAt: new Date(Date.now() - 1000) },
      });
      await claimPendingJobs(1);
      await markJobFailed(jobId, 'Third failure');
      job = await testPrisma.backgroundJob.findUnique({ where: { id: jobId } });

      // Should be FAILED now
      expect(job?.status).toBe('FAILED');
      expect(job?.attempts).toBe(3);
      expect(job?.error).toBe('Third failure');
    });

    it('cancels legacy notification jobs during a rolling deployment', async () => {
      const jobId = await scheduleJob(
        'NOTIFICATION',
        new Date(Date.now() - 1000),
        {
          incidentId: 'legacy-incident',
          userId: 'legacy-user',
          channel: 'EMAIL',
          message: 'legacy notification',
        },
        3
      );

      const [claimed] = await claimPendingJobs(1);
      expect(claimed.attempts).toBe(1);
      await processJob(claimed);

      const stored = await testPrisma.backgroundJob.findUnique({ where: { id: jobId } });
      expect(stored?.status).toBe('CANCELLED');
      expect(stored?.completedAt).not.toBeNull();
      expect(stored?.error).toContain('durable per-channel notification intents');
    });
  });

  describe('Auto-Unsnooze Reliability', () => {
    it('should transition incident from SNOOZED to OPEN when job processed', async () => {
      const incident = await testPrisma.incident.create({
        data: {
          title: 'Snoozed Incident',
          status: 'SNOOZED',
          serviceId: (await testPrisma.service.create({ data: { name: 'Snooze Service' } })).id,
          snoozedUntil: new Date(Date.now() - 1000), // In the past
          snoozeReason: 'Testing',
        },
      });

      const jobId = await scheduleJob('AUTO_UNSNOOZE', new Date(), { incidentId: incident.id });
      const job = await testPrisma.backgroundJob.findUnique({ where: { id: jobId } });

      // Process the job
      await processJob(job);

      // Verify incident state
      const updatedIncident = await testPrisma.incident.findUnique({ where: { id: incident.id } });
      expect(updatedIncident?.status).toBe('OPEN');
      expect(updatedIncident?.snoozedUntil).toBeNull();

      // Verify event logged
      const events = await testPrisma.incidentEvent.findMany({
        where: { incidentId: incident.id },
      });
      expect(events.some(e => e.message.includes('auto-unsnoozed'))).toBe(true);

      // Verify job completed
      const updatedJob = await testPrisma.backgroundJob.findUnique({ where: { id: jobId } });
      expect(updatedJob?.status).toBe('COMPLETED');
    });

    it('should cancel auto-unsnooze job if incident is already RESOLVED', async () => {
      const incident = await testPrisma.incident.create({
        data: {
          title: 'Already Resolved',
          status: 'RESOLVED',
          serviceId: (await testPrisma.service.create({ data: { name: 'Cancel Service' } })).id,
        },
      });

      const jobId = await scheduleJob('AUTO_UNSNOOZE', new Date(), { incidentId: incident.id });
      const job = await testPrisma.backgroundJob.findUnique({ where: { id: jobId } });

      await processJob(job);

      const updatedJob = await testPrisma.backgroundJob.findUnique({ where: { id: jobId } });
      expect(updatedJob?.status).toBe('CANCELLED');
    });
  });
});
