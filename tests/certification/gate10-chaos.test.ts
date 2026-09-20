import { describe, expect, it } from 'vitest';
import { certPrisma } from './helpers';
import { ensureComplianceMonitoringScheduled } from '@/lib/compliance/monitoring/schedule';
import { reconcileTerminalComplianceMonitoringJobs } from '@/lib/compliance/monitoring/reconcile';

describe('Gate 10: Failure & Chaos Recovery Certification', () => {
  it('certifies automatic repair of orphan monitoring runs and reconciliation of crashed worker jobs', async () => {
    // 1. Simulate worker crash during active sweep (orphan RUNNING run without active background job)
    const orphanRun = await certPrisma.complianceMonitoringRun.create({
      data: {
        scheduledFor: new Date(Date.now() - 3600000), // 1 hour ago
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 3600000),
      },
    });

    // 2. Scheduler detects orphan run, marks it FAILED, and schedules replacement
    const repairResult = await ensureComplianceMonitoringScheduled(certPrisma as never, new Date());
    expect(repairResult.scheduled).toBe(true);

    const updatedOrphanRun = await certPrisma.complianceMonitoringRun.findUnique({
      where: { id: orphanRun.id },
    });
    expect(updatedOrphanRun?.status).toBe('FAILED');
    expect((updatedOrphanRun?.errorSummary as { reason?: string })?.reason).toBe(
      'ORPHAN_RUN_WITHOUT_ACTIVE_JOB'
    );

    // 3. Simulate timed-out/zombie sweep job in PROCESSING state that exceeded attempts
    const timedOutRun = await certPrisma.complianceMonitoringRun.create({
      data: {
        scheduledFor: new Date(Date.now() - 3600000),
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 3600000),
      },
    });

    const timedOutJob = await certPrisma.backgroundJob.create({
      data: {
        type: 'COMPLIANCE_EVALUATION_SWEEP',
        status: 'PROCESSING',
        scheduledAt: new Date(Date.now() - 20 * 60 * 1000),
        startedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 mins ago (> 10 min timeout)
        attempts: 3,
        maxAttempts: 3,
        payload: { monitorRunId: timedOutRun.id },
      },
    });

    // 4. Run reconciliation
    const reconciledCount = await reconcileTerminalComplianceMonitoringJobs(certPrisma as never);
    expect(reconciledCount).toBeGreaterThanOrEqual(1);

    const reconciledJob = await certPrisma.backgroundJob.findUnique({
      where: { id: timedOutJob.id },
    });
    expect(reconciledJob?.status).toBe('FAILED');
    expect(reconciledJob?.error).toContain('timed out in PROCESSING state');

    const reconciledRun = await certPrisma.complianceMonitoringRun.findUnique({
      where: { id: timedOutRun.id },
    });
    expect(reconciledRun?.status).toBe('FAILED');
  });
});
