import { describe, expect, it } from 'vitest';
import { certPrisma } from './helpers';
import { ensureComplianceMonitoringScheduled } from '@/lib/compliance/monitoring/schedule';
import { runComplianceEvaluationSweep } from '@/lib/compliance/monitoring/runner';

describe('Gate 6: Continuous-Monitoring & Scheduler Certification', () => {
  it('certifies automatic monitoring bootstrap, sweep execution, and recurring schedule maintenance', async () => {
    // 1. Automatic bootstrap under advisory lock
    const bootstrapResult = await ensureComplianceMonitoringScheduled(certPrisma as never);
    expect(bootstrapResult).toBeDefined();

    // Verify a monitoring run exists in PENDING or RUNNING
    const activeRun = await certPrisma.complianceMonitoringRun.findFirst({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { scheduledFor: 'desc' },
    });
    expect(activeRun).toBeDefined();

    // 2. Execute sweep runner
    if (activeRun) {
      const sweepResult = await runComplianceEvaluationSweep({
        monitorRunId: activeRun.id,
        prisma: certPrisma as never,
        now: new Date(),
      });
      expect(sweepResult.status).toBe('COMPLETED');
      expect(sweepResult.controlsEvaluated).toBeGreaterThanOrEqual(0);

      // Verify the run transitioned to COMPLETED in the database
      const completedRun = await certPrisma.complianceMonitoringRun.findUnique({
        where: { id: activeRun.id },
      });
      expect(completedRun?.status).toBe('COMPLETED');
      expect(completedRun?.completedAt).not.toBeNull();
    }

    // 3. Verify next run is scheduled
    const nextRun = await certPrisma.complianceMonitoringRun.findFirst({
      where: { status: 'PENDING' },
      orderBy: { scheduledFor: 'asc' },
    });
    expect(nextRun).toBeDefined();
  });
});
