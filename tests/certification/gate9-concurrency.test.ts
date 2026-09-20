import { describe, expect, it } from 'vitest';
import { certPrisma } from './helpers';
import { projectControlDrift } from '@/lib/compliance/drift/projector';
import { ensureComplianceMonitoringScheduled } from '@/lib/compliance/monitoring/schedule';

describe('Gate 9: Concurrency & Idempotency Stress Certification', () => {
  it('certifies 50 concurrent drift projections and scheduler bootstraps without deadlocks or duplicates', async () => {
    const controlId = 'CERT-CONCURRENCY-01';

    // Cleanup previous runs for this control
    await certPrisma.complianceDriftEvent.deleteMany({
      where: { controlId },
    });
    await certPrisma.complianceDriftBaseline.deleteMany({
      where: { controlId },
    });
    await certPrisma.complianceEvaluation.deleteMany({
      where: { controlId },
    });

    // 1. Establish initial healthy baseline
    const baselineEval = await certPrisma.complianceEvaluation.create({
      data: {
        controlId,
        status: 'IMPLEMENTED',
        summary: 'Healthy baseline',
        evaluatorId: 'cert-evaluator',
        evaluatorVersion: '1.0.0',
        trigger: 'SCHEDULED',
        evaluatedAt: new Date(Date.now() - 3600000),
        findings: [],
      },
    });

    await projectControlDrift({
      controlId,
      evaluationId: baselineEval.id,
      prisma: certPrisma as never,
    });

    // 2. Create regression evaluation
    const regressedEval = await certPrisma.complianceEvaluation.create({
      data: {
        controlId,
        status: 'ACTION_REQUIRED',
        summary: 'Simulated failure for concurrency test',
        evaluatorId: 'cert-evaluator',
        evaluatorVersion: '1.0.0',
        trigger: 'SCHEDULED',
        evaluatedAt: new Date(),
        findings: [{ code: 'stress-concurrency', severity: 'HIGH', message: 'Test finding' }],
      },
    });

    // 3. Launch 50 concurrent drift projections under PostgreSQL advisory locking
    const promises = Array.from({ length: 50 }).map(() =>
      projectControlDrift({
        controlId,
        evaluationId: regressedEval.id,
        prisma: certPrisma as never,
      })
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(50);

    // 4. Verify exactly ONE active episode exists PER DRIFT KIND (perfect deduplication and idempotency)
    const activeEpisodes = await certPrisma.complianceDriftEvent.findMany({
      where: { controlId, resolvedAt: null },
    });
    const regressionEpisodes = activeEpisodes.filter(e => e.kind === 'CONTROL_STATUS_REGRESSION');
    const findingEpisodes = activeEpisodes.filter(e => e.kind === 'FINDING_SET_CHANGED');
    expect(regressionEpisodes).toHaveLength(1);
    expect(findingEpisodes).toHaveLength(1);

    // 5. Concurrent scheduler bootstraps: clean previous jobs, then launch 10 concurrent bootstraps
    await certPrisma.backgroundJob.deleteMany({
      where: { type: 'COMPLIANCE_EVALUATION_SWEEP' },
    });
    await certPrisma.complianceMonitoringRun.deleteMany({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
    });

    const bootstrapPromises = Array.from({ length: 10 }).map(() =>
      ensureComplianceMonitoringScheduled(certPrisma as never)
    );
    const bootstrapResults = await Promise.all(bootstrapPromises);
    expect(bootstrapResults).toHaveLength(10);

    const scheduledCount = bootstrapResults.filter(r => r.scheduled).length;
    expect(scheduledCount).toBeLessThanOrEqual(1);

    // Verify only ONE active background job exists for COMPLIANCE_EVALUATION_SWEEP
    const activeJobs = await certPrisma.backgroundJob.findMany({
      where: {
        type: 'COMPLIANCE_EVALUATION_SWEEP',
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    });
    expect(activeJobs.length).toBeLessThanOrEqual(1);
  });
});
