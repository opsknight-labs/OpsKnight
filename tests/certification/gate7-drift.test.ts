import { describe, expect, it } from 'vitest';
import { certPrisma } from './helpers';
import { projectControlDrift } from '@/lib/compliance/drift/projector';
import { acknowledgeComplianceDrift } from '@/lib/compliance/drift/acknowledge';

describe('Gate 7: Durable Drift Lifecycle Certification', () => {
  it('certifies baseline creation, drift projection, acknowledgment invariance, and technical auto-recovery', async () => {
    const controlId = 'CERT-DRIFT-LIFECYCLE-01';

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
    const initialEvaluation = await certPrisma.complianceEvaluation.create({
      data: {
        controlId,
        status: 'IMPLEMENTED',
        summary: 'Healthy baseline',
        evaluatorId: 'cert-evaluator',
        evaluatorVersion: '1.0.0',
        trigger: 'SCHEDULED',
        evaluatedAt: new Date('2026-09-20T08:00:00Z'),
        findings: [],
      },
    });

    const baselineResult = await projectControlDrift({
      controlId,
      evaluationId: initialEvaluation.id,
      prisma: certPrisma as never,
    });
    expect(baselineResult.baselineEstablished).toBe(true);

    // 2. Introduce technical regression: STATUS_REGRESSION
    const regressedEvaluation = await certPrisma.complianceEvaluation.create({
      data: {
        controlId,
        status: 'ACTION_REQUIRED',
        summary: 'Encryption key rotation overdue',
        evaluatorId: 'cert-evaluator',
        evaluatorVersion: '1.0.0',
        trigger: 'SCHEDULED',
        evaluatedAt: new Date('2026-09-20T09:00:00Z'),
        findings: [{ code: 'rotation-overdue', severity: 'HIGH', message: 'Key expired' }],
      },
    });

    const driftResult = await projectControlDrift({
      controlId,
      evaluationId: regressedEvaluation.id,
      prisma: certPrisma as never,
    });
    expect(driftResult.driftsOpened).toBeGreaterThanOrEqual(1);

    const activeEpisodes = await certPrisma.complianceDriftEvent.findMany({
      where: { controlId, resolvedAt: null },
    });
    expect(activeEpisodes.length).toBeGreaterThanOrEqual(1);

    const activeEpisode = activeEpisodes.find(e => e.kind === 'CONTROL_STATUS_REGRESSION');
    expect(activeEpisode).toBeDefined();
    expect(activeEpisode?.kind).toBe('CONTROL_STATUS_REGRESSION');

    // 3. Operator acknowledges drift episode
    const certUser = await certPrisma.user.upsert({
      where: { email: 'cert-operator@example.com' },
      update: {},
      create: {
        email: 'cert-operator@example.com',
        name: 'Certification Operator',
        role: 'ADMIN',
      },
    });

    const ackResult = await acknowledgeComplianceDrift({
      driftEventId: activeEpisode!.id,
      userId: certUser.id,
      prisma: certPrisma as never,
    });

    expect(ackResult.status).toBe('ACKNOWLEDGED');
    expect(ackResult.acknowledgedAt).not.toBeNull();
    // Invariant check: ACK never resolves factual technical drift!
    expect(ackResult.resolvedAt).toBeNull();

    // 4. Technical Recovery: subsequent evaluation verifies resolution
    const recoveredEvaluation = await certPrisma.complianceEvaluation.create({
      data: {
        controlId,
        status: 'IMPLEMENTED',
        summary: 'Key rotation resolved and verified',
        evaluatorId: 'cert-evaluator',
        evaluatorVersion: '1.0.0',
        trigger: 'SCHEDULED',
        evaluatedAt: new Date('2026-09-20T10:00:00Z'),
        findings: [],
      },
    });

    const recoveryResult = await projectControlDrift({
      controlId,
      evaluationId: recoveredEvaluation.id,
      prisma: certPrisma as never,
    });
    expect(recoveryResult.driftsResolved).toBeGreaterThanOrEqual(1);

    // Verify episode is now marked resolved
    const resolvedEpisode = await certPrisma.complianceDriftEvent.findUnique({
      where: { id: activeEpisode!.id },
    });
    expect(resolvedEpisode?.resolvedAt).not.toBeNull();
  });
});
